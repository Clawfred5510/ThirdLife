/**
 * Server-side autopilot. Each registered agent with autopilot_enabled=1
 * gets one action per income tick, dispatched by personality.
 *
 * Personalities:
 *   - worker:      free `work` every tick; periodically sells inventory
 *                  at the best bid; saves up.
 *   - trader:      places limit buy/sell orders straddling the current
 *                  spread for a chosen resource; takes fee revenue.
 *   - builder:     buys land and builds the cheapest available income
 *                  building when balance permits.
 *   - accumulator: hoards credits; works free if it has buildings to
 *                  produce from; never speculates.
 *   - social:      cosmetic — broadcasts a chat. No economic effect.
 *   - ambitious:   hybrid: trade + build, aggressive thresholds.
 *
 * Strategy preset (aggressive/balanced/conservative) modulates spending
 * thresholds and risk tolerance.
 *
 * Each tick produces an `[autopilot]` event line for the activity feed.
 */

import {
  getAllAgents,
  getPlayerCredits,
  getPlayerResources,
  updatePlayerResources,
  getPlayerParcels,
  getAllParcels,
  workProduce,
  buyLand,
  claimAndBuild,
  setBuildingType,
  updateBusiness,
  addEvent,
} from '../db';
import {
  BUILDINGS,
  BuildingType,
  ResourceType,
  RESOURCE_TYPES,
  LAND_COST,
  TICK_PRODUCTION,
  AgentStrategy,
  AgentPersonality,
} from '@gamestu/shared';
import { placeOrder, getBook, getBestBid } from '../market/orderBook';
import { getNetWorth } from '../leaderboard';
import { recordGdp, getWorldTick } from '../world';

interface AgentRow {
  id: string;
  name: string;
  personality: string;
  strategy: string;
  autopilot_enabled: number;
  last_autopilot_tick: number;
}

interface StrategyKnobs {
  /** Fraction of balance willing to risk on speculative orders per tick. */
  riskFraction: number;
  /** Distance from mid-price for trader limit orders, in % of mid. */
  spreadPct: number;
  /** Minimum balance buffer to keep before spending (× LAND_COST). */
  reserveMultiplier: number;
}

const STRATEGY: Record<AgentStrategy, StrategyKnobs> = {
  aggressive:   { riskFraction: 0.30, spreadPct: 0.05, reserveMultiplier: 0.5 },
  balanced:     { riskFraction: 0.15, spreadPct: 0.10, reserveMultiplier: 1.0 },
  conservative: { riskFraction: 0.05, spreadPct: 0.20, reserveMultiplier: 2.0 },
};

const CHAT_LINES = [
  'GM, builders.',
  'Anyone selling cheap food?',
  'Building day on the south block.',
  'Materials prices look soft.',
  'Hold your $AMETA.',
  'New parcel, who dis.',
  'Looking for a market spread.',
  'GG to whoever just bought that mall.',
];

/**
 * Run all registered agents' autopilot routines. Called from the
 * GameRoom income tick (every INCOME_TICK_MS). Catches per-agent
 * exceptions so one bad agent can't take down the whole tick.
 */
export function runAutopilotPass(): void {
  const tick = getWorldTick();
  const agents = getAllAgents().filter((a) => a.autopilot_enabled === 1) as AgentRow[];
  for (const agent of agents) {
    try {
      runOne(agent, tick);
    } catch (err) {
      // Don't let a single agent's failure cascade. Log + continue.
      // eslint-disable-next-line no-console
      console.error(`[autopilot] ${agent.name} (${agent.personality}) failed:`, (err as Error).message);
    }
  }
}

function runOne(agent: AgentRow, tick: number): void {
  const personality = agent.personality as AgentPersonality;
  const strategyKey = (agent.strategy as AgentStrategy) in STRATEGY ? agent.strategy as AgentStrategy : 'balanced';
  const knobs = STRATEGY[strategyKey];

  switch (personality) {
    case 'worker':      return runWorker(agent, knobs);
    case 'trader':      return runTrader(agent, knobs);
    case 'builder':     return runBuilder(agent, knobs);
    case 'accumulator': return runAccumulator(agent);
    case 'social':      return runSocial(agent, tick);
    case 'ambitious':   return runAmbitious(agent, knobs);
    default:            return runWorker(agent, knobs);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Personality routines
// ──────────────────────────────────────────────────────────────────────

function runWorker(agent: AgentRow, knobs: StrategyKnobs): void {
  // 1. Always work — produces resources from owned production buildings,
  //    free passive income from hall/market/bank/etc.
  const produced = doWork(agent.id);

  // 2. Sell any resource we have above a small reserve at the best bid.
  //    Worker strategy: lean inventory, convert to AMETA fast.
  const resources = getPlayerResources(agent.id);
  for (const r of RESOURCE_TYPES) {
    const qty = Math.floor(resources[r]);
    if (qty < 5) continue; // tiny, not worth a fee
    const bid = getBestBid(r);
    if (bid <= 0) continue; // empty book → no instant sale
    placeOrder(agent.id, r, 'sell', bid, qty).catch(() => {});
  }

  if (produced.creditsEarned > 0 || produced.anyProduced) {
    addEvent('autopilot', agent.id, {
      personality: 'worker', action: 'work_and_sell',
      earned: produced.creditsEarned, produced: produced.summary,
    }, 'minor');
  }
  void knobs;
}

function runTrader(agent: AgentRow, knobs: StrategyKnobs): void {
  // Pick the deepest book; place a buy below mid and a sell above mid.
  // If there's no opposing side we use BASE_MARKET_PRICES as the anchor
  // — the market designer sets those as a fallback.
  const balance = getPlayerCredits(agent.id);
  if (balance < 100) return;

  const target: ResourceType | null = pickMostLiquidResource();
  if (!target) return;

  const book = getBook(target);
  const bestBid = book.bids[0]?.price ?? 0;
  const bestAsk = book.asks[0]?.price ?? 0;
  const mid = bestBid > 0 && bestAsk > 0 ? Math.floor((bestBid + bestAsk) / 2) : Math.max(bestBid, bestAsk, 10);
  if (mid <= 0) return;

  const offset = Math.max(1, Math.floor(mid * knobs.spreadPct));
  const buyPrice = Math.max(1, mid - offset);
  const sellPrice = mid + offset;

  // Size each leg to a fraction of riskable capital.
  const budget = Math.floor(balance * knobs.riskFraction);
  const buyQty = Math.max(1, Math.floor(budget / buyPrice / 2));

  // Only place sell if we have inventory to back it.
  const myRes = getPlayerResources(agent.id)[target];
  const sellQty = Math.min(Math.floor(myRes), Math.max(0, Math.floor(buyQty / 2)));

  placeOrder(agent.id, target, 'buy', buyPrice, buyQty).catch(() => {});
  if (sellQty > 0) {
    placeOrder(agent.id, target, 'sell', sellPrice, sellQty).catch(() => {});
  }

  addEvent('autopilot', agent.id, {
    personality: 'trader', action: 'spread', resource: target,
    bid: buyPrice, ask: sellPrice, buyQty, sellQty,
  }, 'minor');
}

function runBuilder(agent: AgentRow, knobs: StrategyKnobs): void {
  // Goal: own a portfolio. Buy cheapest empty parcel and build the
  // cheapest income building affordable, keeping a reserve.
  const balance = getPlayerCredits(agent.id);
  const reserve = LAND_COST * knobs.reserveMultiplier;

  // Affordable building list (income-paying), cheapest first.
  const affordable = (Object.values(BUILDINGS) as Array<typeof BUILDINGS[BuildingType]>)
    .filter((b) => b.income > 0)
    .sort((a, b) => a.cost - b.cost)
    .find((b) => balance >= b.cost + LAND_COST + reserve);
  if (!affordable) {
    // Can't afford to build — work to earn instead.
    return runWorker(agent, knobs);
  }

  const target = pickAvailableParcel();
  if (!target) return;

  const result = claimAndBuild(agent.id, target.id, affordable.type, affordable.cost, affordable.label);
  if (result.ok) {
    addEvent('autopilot', agent.id, {
      personality: 'builder', action: 'claim_and_build',
      parcel: target.id, building: affordable.type, cost: affordable.cost + LAND_COST,
    }, 'major');
  }
}

function runAccumulator(agent: AgentRow): void {
  // Just work. Don't speculate, don't expand. Let income compound.
  const produced = doWork(agent.id);
  if (produced.creditsEarned > 0 || produced.anyProduced) {
    addEvent('autopilot', agent.id, {
      personality: 'accumulator', action: 'work',
      earned: produced.creditsEarned,
    }, 'minor');
  }
}

function runSocial(agent: AgentRow, tick: number): void {
  // Cosmetic — emit a chat event so the world feels alive. Not every
  // tick (would spam) — once every 3 ticks per agent, deterministic
  // by id+tick to avoid clumping.
  const hash = simpleHash(agent.id + ':' + tick);
  if (hash % 3 !== 0) return;
  const line = CHAT_LINES[hash % CHAT_LINES.length];
  addEvent('autopilot', agent.id, {
    personality: 'social', action: 'chat', message: line,
  }, 'minor');
}

function runAmbitious(agent: AgentRow, knobs: StrategyKnobs): void {
  // Hybrid — work first, then either trade or build depending on
  // current balance vs build threshold. Aggressive variant gates lower.
  const balance = getPlayerCredits(agent.id);
  doWork(agent.id);

  if (balance >= LAND_COST + 50_000) {
    runBuilder(agent, knobs);
  } else if (balance >= 1_000) {
    runTrader(agent, knobs);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Action helpers — share work-action semantics with the REST endpoints
// ──────────────────────────────────────────────────────────────────────

function doWork(agentId: string): {
  creditsEarned: number;
  produced: Partial<Record<ResourceType, number>>;
  anyProduced: boolean;
  summary: string;
} {
  const parcels = getPlayerParcels(agentId);
  let creditsEarned = 0;
  const produced: Partial<Record<ResourceType, number>> = {};
  const resources = getPlayerResources(agentId);

  for (const p of parcels) {
    const buildingType = (p as { building_type?: string }).building_type;
    if (!buildingType) continue;
    const spec = BUILDINGS[buildingType as BuildingType];
    if (!spec) continue;
    if (spec.produces && spec.amount) {
      resources[spec.produces] += spec.amount;
      produced[spec.produces] = (produced[spec.produces] ?? 0) + spec.amount;
    }
    if (spec.income > 0) creditsEarned += spec.income;
  }

  if (creditsEarned > 0 || Object.keys(produced).length > 0) {
    workProduce(agentId, creditsEarned, resources);
    if (creditsEarned > 0) recordGdp(creditsEarned);
  }
  void TICK_PRODUCTION; // silence unused if pruned

  return {
    creditsEarned,
    produced,
    anyProduced: Object.keys(produced).length > 0,
    summary: Object.entries(produced).map(([k, v]) => `${v} ${k}`).join(', '),
  };
}

function pickAvailableParcel(): { id: number } | null {
  const all = getAllParcels();
  const free = all.filter((p) => !p.owner_id);
  if (free.length === 0) return null;
  // Cheapest doesn't vary per parcel today — pick a random unclaimed.
  return free[Math.floor(Math.random() * free.length)];
}

function pickMostLiquidResource(): ResourceType | null {
  let best: ResourceType | null = null;
  let bestDepth = 0;
  for (const r of RESOURCE_TYPES) {
    const book = getBook(r);
    const depth =
      (book.bids[0]?.quantity ?? 0) + (book.asks[0]?.quantity ?? 0) + (book.recentTrades.length || 0);
    if (depth > bestDepth) { bestDepth = depth; best = r; }
  }
  // If everything is empty, just pick food (cheapest, fastest fills).
  return best ?? 'food';
}

function simpleHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

// Suppress unused-import lint when reputation/setBuildingType are
// referenced from external callers but not directly here yet.
void getNetWorth;
void setBuildingType;
void updateBusiness;
void buyLand;
