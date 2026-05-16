import { IEconomy } from './IEconomy';

/**
 * Stub for the on-chain economy. The $AMETA smart contract is being
 * developed by another team. When it ships:
 *
 *   1. Pull the ABI + deployed address into env (AMETA_CONTRACT_ADDRESS,
 *      AMETA_RPC_URL, AMETA_ADMIN_KEY).
 *   2. Use viem (already a dep from wallet auth) to wrap reads + writes.
 *   3. Decide settlement model:
 *        - "every credit movement is on-chain"  → simple, slow, expensive
 *        - "in-memory cache settled periodically" → fast, cheaper, requires
 *          a background settler. RECOMMENDED.
 *
 * For the cache model: this class wraps an InMemoryEconomy as a hot
 * cache, then settles net deltas to chain on a timer or threshold.
 *
 * Until the contract lands, throwing here forces an explicit decision —
 * we don't silently fall back to in-memory.
 */
export class OnChainEconomy implements IEconomy {
  constructor() {
    throw new Error(
      'OnChainEconomy is not implemented yet — set ECONOMY_BACKEND=memory until the smart contract is deployed.',
    );
  }
  async getBalance(): Promise<number> {
    throw new Error('not implemented');
  }
  async credit(): Promise<void> {
    throw new Error('not implemented');
  }
  async debit(): Promise<{ ok: boolean; reason?: string }> {
    throw new Error('not implemented');
  }
  async transfer(): Promise<{ ok: boolean; reason?: string; fee?: number }> {
    throw new Error('not implemented');
  }
  async allocate(): Promise<{ ok: boolean; reason?: string }> {
    throw new Error('not implemented');
  }
}
