import {
  getOrCreatePlayer,
  getPlayerCredits,
  updatePlayerCredits,
  playerExists,
  addEvent,
  getAgentById,
  transferWithFee,
} from '../db';
import { TRANSFER_FEE_BPS, BPS_DENOMINATOR } from '@gamestu/shared';
import { IEconomy, WORLD_TREASURY_ID } from './IEconomy';
import { notifyWalletChanged } from '../events/walletEvents';

/**
 * Default economy backend — credits live in the players table credits
 * column, mutated via the existing db helpers. Fees flow to a reserved
 * WORLD_TREASURY player record (auto-created on first use).
 */
export class InMemoryEconomy implements IEconomy {
  private treasuryReady = false;

  private ensureTreasury(): void {
    if (this.treasuryReady) return;
    if (!playerExists(WORLD_TREASURY_ID)) {
      getOrCreatePlayer(WORLD_TREASURY_ID, 'World Treasury');
    }
    this.treasuryReady = true;
  }

  async getBalance(playerId: string): Promise<number> {
    return getPlayerCredits(playerId);
  }

  async credit(playerId: string, amount: number, reason: string): Promise<void> {
    if (amount <= 0) return;
    const current = getPlayerCredits(playerId);
    updatePlayerCredits(playerId, current + amount);
    addEvent('credit', playerId, { amount, reason });
    notifyWalletChanged(playerId);
  }

  async debit(
    playerId: string,
    amount: number,
    reason: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    if (amount <= 0) return { ok: false, reason: 'invalid_amount' };
    const current = getPlayerCredits(playerId);
    if (current < amount) return { ok: false, reason: 'insufficient_balance' };
    updatePlayerCredits(playerId, current - amount);
    addEvent('debit', playerId, { amount, reason });
    notifyWalletChanged(playerId);
    return { ok: true };
  }

  async transfer(
    fromId: string,
    toId: string,
    amount: number,
    reason: string,
  ): Promise<{ ok: boolean; reason?: string; fee?: number }> {
    this.ensureTreasury();
    const fee = amount > 0 && Number.isFinite(amount)
      ? Math.floor((amount * TRANSFER_FEE_BPS) / BPS_DENOMINATOR)
      : 0;
    const result = transferWithFee(fromId, toId, amount, fee, WORLD_TREASURY_ID);
    if (!result.ok) return { ok: false, reason: result.reason };

    addEvent('transfer', fromId, { to: toId, amount, fee, reason });
    notifyWalletChanged(fromId);
    notifyWalletChanged(toId);
    return { ok: true, fee };
  }

  async allocate(
    walletId: string,
    agentId: string,
    amount: number,
    direction: 'fund' | 'reclaim',
  ): Promise<{ ok: boolean; reason?: string }> {
    if (amount <= 0 || !Number.isFinite(amount) || !Number.isInteger(amount)) {
      return { ok: false, reason: 'invalid_amount' };
    }
    const agent = getAgentById(agentId);
    if (!agent) return { ok: false, reason: 'agent_not_found' };
    if (agent.owner_wallet?.toLowerCase() !== walletId.toLowerCase()) {
      return { ok: false, reason: 'not_owner' };
    }
    const fromId = direction === 'fund' ? walletId : agentId;
    const toId   = direction === 'fund' ? agentId  : walletId;
    const fromBal = getPlayerCredits(fromId);
    if (fromBal < amount) return { ok: false, reason: 'insufficient_balance' };

    updatePlayerCredits(fromId, fromBal - amount);
    updatePlayerCredits(toId,   getPlayerCredits(toId) + amount);
    addEvent('allocate', walletId, { agent: agentId, amount, direction });
    notifyWalletChanged(walletId);
    return { ok: true };
  }
}
