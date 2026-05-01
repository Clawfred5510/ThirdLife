import { IEconomy } from './IEconomy';
import { InMemoryEconomy } from './InMemoryEconomy';
import { OnChainEconomy } from './OnChainEconomy';

export { IEconomy, WORLD_TREASURY_ID } from './IEconomy';
export { InMemoryEconomy } from './InMemoryEconomy';
export { OnChainEconomy } from './OnChainEconomy';

let active: IEconomy | null = null;

/**
 * Get the active economy backend. Selected by ECONOMY_BACKEND env var,
 * defaults to in-memory. Singleton — same instance per server process.
 */
export function economy(): IEconomy {
  if (active) return active;
  const backend = (process.env.ECONOMY_BACKEND ?? 'memory').toLowerCase();
  if (backend === 'onchain') {
    active = new OnChainEconomy();
  } else {
    active = new InMemoryEconomy();
  }
  return active;
}

/** Test-only override. Reset between tests. */
export function setEconomyForTesting(impl: IEconomy | null): void {
  active = impl;
}
