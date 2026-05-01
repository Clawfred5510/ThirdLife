/**
 * Economy abstraction. All credit movement in the game goes through this.
 *
 * Two implementations:
 *   - InMemoryEconomy: wraps the existing SQLite credit columns. Current default.
 *   - OnChainEconomy:  binds to the $AMETA smart contract on Base chain.
 *                      Stub today; populated when the contract team ships.
 *
 * Selected at boot via process.env.ECONOMY_BACKEND ∈ {"memory","onchain"}.
 *
 * Why this exists: when the smart contract is ready, swapping the
 * implementation requires zero changes to game logic. Until then we want
 * exactly one place to enforce fees, taxes, and treasury sinks.
 */
export interface IEconomy {
  /** Current balance for a player/agent. */
  getBalance(playerId: string): Promise<number>;

  /** Add `amount` to a player's balance. Reason is recorded with the event. */
  credit(playerId: string, amount: number, reason: string): Promise<void>;

  /** Subtract `amount` from a player's balance. Returns `ok:false` if insufficient. */
  debit(
    playerId: string,
    amount: number,
    reason: string,
  ): Promise<{ ok: boolean; reason?: string }>;

  /**
   * Move `amount` from one player to another. Subject to the global
   * TRANSFER_FEE_BPS — the fee comes out of the sender's balance, on top
   * of `amount`, and is forwarded to WORLD_TREASURY.
   */
  transfer(
    fromId: string,
    toId: string,
    amount: number,
    reason: string,
  ): Promise<{ ok: boolean; reason?: string; fee?: number }>;
}

/** Reserved player ID used as the fee/tax sink. Created lazily on first use. */
export const WORLD_TREASURY_ID = '__world_treasury__';
