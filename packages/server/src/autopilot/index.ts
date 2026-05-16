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
  savePlayerPosition,
  type ParcelRow,
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
  workplace_parcel_id: number | null;
  job: string | null;
}

export interface AgentMove {
  agentId: string;
  x: number;
  y: number;
  z: number;
}

// Spawn plaza — where social/idle agents stand. Mirrors the human spawn
// position so they look like a welcoming crowd at the origin.
const SPAWN_X = 0;
const SPAWN_Y = 0;
const SPAWN_Z = -80;

// Market plaza — where traders "stand" while placing orders. Visual only;
// has no effect on order book mechanics. Currently the world centre.
const MARKET_X = 0;
const MARKET_Y = 0;
const MARKET_Z = 0;

// Convert a parcel's grid coordinates to its world-space centre. Must
// match the EXPLORE handler in GameRoom.ts which uses the same mapping.
function parcelCenter(parcel: ParcelRow): { x: number; y: number; z: number } {
  return {
    x: parcel.grid_x * 48 - 1200 + 20,
    y: 0,
    z: parcel.grid_y * 48 - 1200 + 20,
  };
}

/**
 * Deterministic per-agent offset around the spawn plaza so dozens of
 * unemployed agents don't visually pile up at exactly (0, 0, -80).
 * Same hash for the same agent across ticks → no jitter.
 */
function spawnSpreadFor(agentId: string): { x: number; y: number; z: number } {
  const h = simpleHash(agentId);
  const angle = (h % 360) * (Math.PI / 180);
  const radius = 6 + ((h >>> 8) % 24); // 6–30 units from spawn
  return {
    x: SPAWN_X + Math.cos(angle) * radius,
    y: SPAWN_Y,
    z: SPAWN_Z + Math.sin(angle) * radius,
  };
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
export function runAutopilotPass(): AgentMove[] {
  const tick = getWorldTick();
  const agents = getAllAgents().filter((a) => a.autopilot_enabled === 1) as AgentRow[];
  // Snapshot parcels once per tick so per-agent routines don't each scan
  // 2025 rows. Indexed by id for O(1) workplace lookups.
  const parcelMap = new Map<number, ParcelRow>();
  for (const p of getAllParcels()) parcelMap.set(p.id, p);

  const moves: AgentMove[] = [];
  for (const agent of agents) {
    try {
      const move = runOne(agent, tick, parcelMap);
      if (move) {
        savePlayerPosition(agent.id, move.x, move.y, move.z);
        moves.push({ agentId: agent.id, x: move.x, y: move.y, z: move.z });
      }
    } catch (err) {
      // Don't let a single agent's failure cascade. Log + continue.
      // eslint-disable-next-line no-console
      console.error(`[autopilot] ${agent.name} (${agent.personality}) failed:`, (err as Error).message);
    }
  }
  return moves;
}

function runOne(agent: AgentRow, tick: number, parcels: Map<number, ParcelRow>): { x: number; y: number; z: number } | null {
  const personality = agent.personality as AgentPersonality;
  const strategyKey = (agent.strategy as AgentStrategy) in STRATEGY ? agent.strategy as AgentStrategy : 'balanced';
  const knobs = STRATEGY[strategyKey];
  const workplace = agent.workplace_parcel_id != null ? parcels.get(agent.workplace_parcel_id) ?? null : null;

  switch (personality) {
    case 'worker':      return runWorker(agent, knobs, workplace);
    case 'trader':      return runTrader(agent, knobs);
    case 'builder':     return runBuilder(agent, knobs, parcels);
    case 'accumulator': return runAccumulator(agent, workplace);
    case 'social':      return runSocial(agent, tick);
    case 'ambitious':   return runAmbitious(agent, knobs, workplace, parcels);
    default:            return runWorker(agent, knobs, workplace);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Personality routines
// ──────────────────────────────────────────────────────────────────────

function runWorker(agent: AgentRow, knobs: StrategyKnobs, workplace: ParcelRow | null): { x: number; y: number; z: number } | null {
  // 1. Always work — at the assigned workplace if set, else at the
  //    agent's owned production buildings. Workplace can belong to ANY
  //    player (freelancer model) — the agent earns the output regardless.
  const produced = doWork(agent.id, workplace);

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
      workplace: workplace?.id ?? null,
    }, 'minor');
  }
  void knobs;
  // Position: stand at the workplace if assigned, else stay at spawn.
  if (workplace) return parcelCenter(workplace);
  return spawnSpreadFor(agent.id);
}

function runTrader(agent: AgentRow, knobs: StrategyKnobs): { x: number; y: number; z: number } | null {
  // Pick the deepest book; place a buy below mid and a sell above mid.
  // If there's no opposing side we use BASE_MARKET_PRICES as the anchor
  // — the market designer sets those as a fallback.
  const balance = getPlayerCredits(agent.id);
  if (balance < 100) return { x: MARKET_X, y: MARKET_Y, z: MARKET_Z };

  const target: ResourceType | null = pickMostLiquidResource();
  if (!target) return { x: MARKET_X, y: MARKET_Y, z: MARKET_Z };

  const book = getBook(target);
  const bestBid = book.bids[0]?.price ?? 0;
  const bestAsk = book.asks[0]?.price ?? 0;
  const mid = bestBid > 0 && bestAsk > 0 ? Math.floor((bestBid + bestAsk) / 2) : Math.max(bestBid, bestAsk, 10);
  if (mid <= 0) return { x: MARKET_X, y: MARKET_Y, z: MARKET_Z };

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
  return { x: MARKET_X, y: MARKET_Y, z: MARKET_Z };
}

function runBuilder(agent: AgentRow, knobs: StrategyKnobs, parcels: Map<number, ParcelRow>): { x: number; y: number; z: number } | null {
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
    return runWorker(agent, knobs, null);
  }

  const target = pickAvailableParcel();
  if (!target) return spawnSpreadFor(agent.id);

  const result = claimAndBuild(agent.id, target.id, affordable.type, affordable.cost, affordable.label);
  if (result.ok) {
    addEvent('autopilot', agent.id, {
      personality: 'builder', action: 'claim_and_build',
      parcel: target.id, building: affordable.type, cost: affordable.cost + LAND_COST,
    }, 'major');
    const claimed = parcels.get(target.id);
    if (claimed) return parcelCenter(claimed);
  }
  return spawnSpreadFor(agent.id);
}

function runAccumulator(agent: AgentRow, workplace: ParcelRow | null): { x: number; y: number; z: number } | null {
  // Just work. Don't speculate, don't expand. Let income compound.
  const produced = doWork(agent.id, workplace);
  if (produced.creditsEarned > 0 || produced.anyProduced) {
    addEvent('autopilot', agent.id, {
      personality: 'accumulator', action: 'work',
      earned: produced.creditsEarned,
    }, 'minor');
  }
  // Banker stands at their bank parcel if owned, else workplace, else spawn.
  if (workplace) return parcelCenter(workplace);
  const owned = getPlayerParcels(agent.id);
  const bank = owned.find((p) => (p as any).building_type === 'bank') ?? owned[0];
  if (bank) return parcelCenter(bank as ParcelRow);
  return spawnSpreadFor(agent.id);
}

function runSocial(agent: AgentRow, tick: number): { x: number; y: number; z: number } | null {
  // Cosmetic — emit a chat event so the world feels alive. Not every
  // tick (would spam) — once every 3 ticks per agent, deterministic
  // by id+tick to avoid clumping.
  const hash = simpleHash(agent.id + ':' + tick);
  if (hash % 3 === 0) {
    const line = CHAT_LINES[hash % CHAT_LINES.length];
    addEvent('autopilot', agent.id, {
      personality: 'social', action: 'chat', message: line,
    }, 'minor');
  }
  // Greeter stands near spawn so newcomers see them — but spread by id
  // so multiple greeters don't overlap exactly.
  return spawnSpreadFor(agent.id);
}

function runAmbitious(agent: AgentRow, knobs: StrategyKnobs, workplace: ParcelRow | null, parcels: Map<number, ParcelRow>): { x: number; y: number; z: number } | null {
  // Hybrid — work first, then either trade or build depending on
  // current balance vs build threshold. Aggressive variant gates lower.
  const balance = getPlayerCredits(agent.id);
  doWork(agent.id, workplace);

  if (balance >= LAND_COST + 50_000) {
    return runBuilder(agent, knobs, parcels);
  } else if (balance >= 1_000) {
    return runTrader(agent, knobs);
  }
  if (workplace) return parcelCenter(workplace);
  return spawnSpreadFor(agent.id);
}

// ──────────────────────────────────────────────────────────────────────
// Action helpers — share work-action semantics with the REST endpoints
// ──────────────────────────────────────────────────────────────────────

function doWork(agentId: string, workplace: ParcelRow | null): {
  creditsEarned: number;
  produced: Partial<Record<ResourceType, number>>;
  anyProduced: boolean;
  summary: string;
} {
  // Workplace mode (freelancer): work at the assigned parcel regardless
  // of who owns it. Output credits this agent. Parcel owner's separate
  // building-income tick is unaffected by this — no double accounting.
  // No workplace: work over the agent's own owned production buildings
  // (the legacy behaviour).
  const targets: ParcelRow[] = workplace
    ? [workplace]
    : (getPlayerParcels(agentId) as ParcelRow[]);
  let creditsEarned = 0;
  const produced: Partial<Record<ResourceType, number>> = {};
  const resources = getPlayerResources(agentId);

  for (const p of targets) {
    const buildingType = (p as { building_type?: string }).building_type;
    if (!buildingType) continue;
    const spec = BUILDINGS[buildingType as BuildingType];
    if (!spec) continue;
    if (spec.produces && spec.amount) {
      resources[spec.produces] += spec.amount;
      produced[spec.produces] = (produced[spec.produces] ?? 0) + spec.amount;
    }
    // Income only applies to owned parcels — a freelancer at someone
    // else's parcel produces resources but doesn't collect the building's
    // passive income (that belongs to the parcel owner).
    if (!workplace && spec.income > 0) creditsEarned += spec.income;
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
