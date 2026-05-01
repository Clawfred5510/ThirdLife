/**
 * Global world state — tick counter and rolling GDP. The GDP
 * accumulator collects all credit-earning events during the current
 * income tick (work, passive income, market trades). When the tick
 * rolls, the accumulator becomes the published "GDP for the previous
 * tick" and resets to 0.
 *
 * GameRoom owns the tick advance. Agent endpoints + the order book
 * call recordGdp() whenever credits are minted or transferred between
 * players (treasury fees do count as GDP since they leave a player's
 * hands; transfers are double-counted intentionally — sender's
 * "spend" is recipient's "earn").
 */

let currentTick = 0;
let gdpThisTick = 0;
let lastTickGdp = 0;

export function getWorldTick(): number {
  return currentTick;
}

export function getCurrentGdp(): number {
  return gdpThisTick;
}

export function getLastTickGdp(): number {
  return lastTickGdp;
}

export function recordGdp(amount: number): void {
  if (amount > 0 && Number.isFinite(amount)) gdpThisTick += amount;
}

/** Called by GameRoom when the income tick fires. */
export function advanceWorldTick(): void {
  currentTick += 1;
  lastTickGdp = gdpThisTick;
  gdpThisTick = 0;
}

export function resetWorldForTesting(): void {
  currentTick = 0;
  gdpThisTick = 0;
  lastTickGdp = 0;
}
