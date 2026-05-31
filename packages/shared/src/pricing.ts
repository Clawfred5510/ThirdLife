/**
 * ThirdLife pricing constants — locked v1 values.
 *
 * Single source of truth for every $AMETA cost, fee, multiplier, threshold,
 * and tier-driven balance number in the game. The spec (`thirdlife-updated-
 * spec.md` §9) locks these for v1 and they should only be changed here.
 *
 * Engine constants (world size, grid, camera, avatar animation) live in
 * `constants.ts`. Pricing lives here.
 *
 * Naming convention: every $AMETA-denominated number ends in `_AMETA`,
 * every materials number ends in `_MATERIALS`, every fee in basis points
 * ends in `_BPS`, every tick-count ends in `_TICKS`.
 */

// Local type alias — keep in sync with constants.ts ResourceType.
// Defined here so pricing.ts has no dependency on constants.ts (avoids
// import cycles when constants.ts later re-exports from pricing).
type ResourceType = 'food' | 'materials' | 'energy' | 'luxury';

// ──────────────────────────────────────────────────────────────────────
// Tier model (universal across every production curve)
// ──────────────────────────────────────────────────────────────────────

/** Five tier names, indexed 0..4 → bronze..diamond. */
export const TIER_NAMES = ['bronze', 'silver', 'gold', 'platinum', 'diamond'] as const;
export type Tier = (typeof TIER_NAMES)[number];

/** Tier index for a name. Useful when keying into the array constants below. */
export const TIER_INDEX: Record<Tier, number> = {
  bronze: 0,
  silver: 1,
  gold: 2,
  platinum: 3,
  diamond: 4,
};

/** Universal production multiplier. Applies to both base passive output
 *  and per-agent contribution. Spec §2 hard ceiling: never exceed 10×. */
export const TIER_MULTIPLIER = [1, 2, 3, 5, 10] as const;

// ──────────────────────────────────────────────────────────────────────
// Tick cadence + lifecycle
// ──────────────────────────────────────────────────────────────────────

/** Tick length in ms. Locked at 10 minutes per spec §8.
 *  Dev override: set `TICK_LENGTH_MS` env var on the server to a smaller
 *  number for faster iteration. */
export const TICK_LENGTH_MS = 10 * 60 * 1000;

/** Max offline accrual: 24 hours worth of ticks. Spec §8. */
export const MAX_OFFLINE_TICKS = 144;

/** Number of consecutive starvation ticks before an agent goes dormant.
 *  Spec §2: "grace period (3 ticks suggested)". */
export const STARVATION_GRACE_TICKS = 3;

/** Food cost to revive a dormant agent. Spec §2. */
export const REVIVE_COST_FOOD = 100;

/** Food eaten by every active agent per tick. */
export const FOOD_PER_AGENT_PER_TICK = 1;

/** Energy consumed by each producing building per tick.
 *  Spec §2: "1 energy per tick to operate, regardless of tier".
 *  Luxury buildings (Housing, Civic) do not consume energy. */
export const ENERGY_PER_PRODUCING_BUILDING_PER_TICK = 1;

// ──────────────────────────────────────────────────────────────────────
// Universal costs (spec §9)
// ──────────────────────────────────────────────────────────────────────

/** Cost of one land parcel. Flat across all ranks; plot cap is rank-gated. */
export const LAND_COST_AMETA = 200_000;

/** Cost to purchase one in-game agent. Flat across all ranks. */
export const IN_GAME_AGENT_COST_AMETA = 200_000;

/** External agents are free to register; they still consume 1 food/tick. */
export const EXTERNAL_AGENT_COST_AMETA = 0;

/** $AMETA paid per tick to each work-role agent stationed at a building.
 *  Funded entirely by the World Treasury (the fee sink) — never by the parcel
 *  owner — and only paid while the treasury can afford it. Kept deliberately
 *  low so agent labor is a gentle trickle, not a runaway faucet. */
export const WORK_WAGE_AMETA_PER_TICK = 5;

/** Starting balance for new wallets in production. Players must purchase
 *  $AMETA on Uniswap before playing. Owner testing uses `TEST_BALANCE`
 *  env var to override on every login. */
export const STARTING_BALANCE_AMETA = 0;

/** Recommended entry budget for "playing properly". Surfaced in onboarding
 *  UI only; not enforced. Spec §9. */
export const RECOMMENDED_ENTRY_BUDGET_AMETA = 1_000_000;

// ──────────────────────────────────────────────────────────────────────
// Building costs by tier (spec §9)
// ──────────────────────────────────────────────────────────────────────

/** Construction cost in $AMETA, indexed by tier (bronze→diamond) for the
 *  Food / Materials / Energy production tracks. */
export const PRODUCTION_BUILDING_AMETA_COST = [
  50_000,        // I — Bronze
  200_000,       // II — Silver
  750_000,       // III — Gold
  3_000_000,     // IV — Platinum
  10_000_000,    // V — Diamond
] as const;

/** Materials required to build a production building, by tier. */
export const PRODUCTION_BUILDING_MATERIAL_COST = [
  0,             // I — Bronze
  2_000,         // II — Silver
  8_000,         // III — Gold
  30_000,        // IV — Platinum
  100_000,       // V — Diamond
] as const;

/** Construction cost in $AMETA for Luxury Housing AND Luxury Civic tracks.
 *  Both tracks share identical pricing per spec §9. */
export const LUXURY_BUILDING_AMETA_COST = [
  50_000,        // I — Bronze (Apartment / Office)
  200_000,       // II — Silver (House / Market)
  750_000,       // III — Gold (Penthouse / Bank)
  3_000_000,     // IV — Platinum (Villa / Town Hall)
  12_000_000,    // V — Diamond (Mansion / Gala Hall)
] as const;

/** Materials required to build a luxury building (Housing or Civic), by tier. */
export const LUXURY_BUILDING_MATERIAL_COST = [
  1_000,         // I — Bronze
  3_000,         // II — Silver
  12_000,        // III — Gold
  40_000,        // IV — Platinum
  150_000,       // V — Diamond
] as const;

// ──────────────────────────────────────────────────────────────────────
// Crafting (spec §4)
// ──────────────────────────────────────────────────────────────────────

/** Items produced by one craft agent per tick at each tier.
 *  Equals TIER_MULTIPLIER. */
export const CRAFT_ITEMS_PER_TICK_BY_TIER = [1, 2, 3, 5, 10] as const;

/** Input resources consumed per crafted item. Same for all tiers and chains. */
export const CRAFT_RESOURCES_PER_ITEM = 5;

/** Burn value (rank points) per crafted item, by tier. */
export const CRAFT_BURN_VALUE_BY_TIER = [1, 3, 6, 12, 25] as const;

/** Passive luxury per tick from a Housing or Civic building, by tier.
 *  Spec §7 says "trickle / steady / strong / very strong / peak" — the
 *  numeric values are inferred to parallel CRAFT_BURN_VALUE_BY_TIER so a
 *  Tier-I Apartment + Office combined match a single Tier-I crafter. */
export const LUXURY_PASSIVE_PER_TICK_BY_TIER = [1, 3, 6, 12, 25] as const;

// ──────────────────────────────────────────────────────────────────────
// Marketplace seeds (spec §9)
// ──────────────────────────────────────────────────────────────────────

/** NPC-seeded price floors in $AMETA per unit. Player order book sets
 *  actual prices over time; these anchor the launch market. */
export const NPC_SEED_PRICE_AMETA: Record<ResourceType, number> = {
  food: 50,
  materials: 100,
  energy: 150,
  luxury: 250,
};

// ──────────────────────────────────────────────────────────────────────
// Rank thresholds + caps (spec §5, §9)
// ──────────────────────────────────────────────────────────────────────

/** Cumulative luxury burned needed to reach each rank. */
export const RANK_BURN_THRESHOLD: Record<Tier, number> = {
  bronze: 1,           // any first burn
  silver: 5_000,
  gold: 30_000,
  platinum: 200_000,
  diamond: 1_500_000,
};

/** Returns the highest rank the given lifetime burn qualifies for, or
 *  null if the player has never burned. Single source of truth for
 *  promotion math — used by both the DB layer and the API. */
export function rankFromLifetimeBurn(lifetime: number): Tier | null {
  if (lifetime <= 0) return null;
  if (lifetime >= RANK_BURN_THRESHOLD.diamond)  return 'diamond';
  if (lifetime >= RANK_BURN_THRESHOLD.platinum) return 'platinum';
  if (lifetime >= RANK_BURN_THRESHOLD.gold)     return 'gold';
  if (lifetime >= RANK_BURN_THRESHOLD.silver)   return 'silver';
  if (lifetime >= RANK_BURN_THRESHOLD.bronze)   return 'bronze';
  return null;
}

/** In-game agent cap (purchasable + assignable) by player rank. */
export const IN_GAME_AGENT_CAP_BY_RANK: Record<Tier, number> = {
  bronze: 5,
  silver: 10,
  gold: 25,
  platinum: 50,
  diamond: 100,
};

/** External (API-driven) agent cap by player rank. */
export const EXTERNAL_AGENT_CAP_BY_RANK: Record<Tier, number> = {
  bronze: 1,
  silver: 2,
  gold: 3,
  platinum: 4,
  diamond: 5,
};

/** Maximum land parcels a player can own at each rank. Diamond's hard cap
 *  is a soft 200 (effectively unlimited at that scale). */
export const LAND_CAP_BY_RANK: Record<Tier, number> = {
  bronze: 4,
  silver: 8,
  gold: 20,
  platinum: 50,
  diamond: 200,
};

// Note: the spec doc mentions a Platinum +5% / Diamond +15% production
// bonus, but owner override 2026-05-20: there is **no** rank-based
// production multiplier at any tier. Production is determined purely by
// (building_tier × (1 + assigned_produce_agents)) gated by binary
// energy. The economic edge from ranking up comes from caps, access to
// higher-tier buildings, and lower fees — not from a passive multiplier.

// ──────────────────────────────────────────────────────────────────────
// Fees (spec §8, basis points; 100 = 1%)
// ──────────────────────────────────────────────────────────────────────

/** Progressive marketplace fee, paid by the taker (matching aggressor)
 *  in $AMETA. Routed to the treasury wallet. */
export const MARKETPLACE_FEE_BPS_BY_RANK: Record<Tier, number> = {
  bronze: 100,    // 1%
  silver: 200,    // 2%
  gold: 300,      // 3%
  platinum: 400,  // 4%
  diamond: 500,   // 5%
};

/** Flat 1% platform fee applied to every property/building transaction
 *  (claim land, build, demolish refund, etc.). Routed to the treasury. */
export const PROPERTY_FEE_BPS = 100;

/** Flat 1% fee on $AMETA transfers between two different wallets.
 *  Allocate/reclaim within the same wallet's agents is fee-free. */
export const TRANSFER_FEE_BPS = 100;

/** Basis-points denominator: 10000 = 100%. */
export const BPS_DENOMINATOR = 10_000;

// ──────────────────────────────────────────────────────────────────────
// Agent roles (spec §4)
// ──────────────────────────────────────────────────────────────────────

/** The three role assignments for in-game agents. External agents
 *  implicitly have a fourth role (`trade`) enforced server-side via the
 *  `is_external` flag rather than this enum. */
export const AGENT_ROLES = ['work', 'produce', 'craft'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** Default role assigned at agent purchase if the owner doesn't pick one. */
export const DEFAULT_AGENT_ROLE: AgentRole = 'work';

// ──────────────────────────────────────────────────────────────────────
// External agent API limits (spec §11 — calibrate from live data)
// ──────────────────────────────────────────────────────────────────────

/** Default per-agent rate limits for the external API. Tunable after
 *  observing live load patterns. */
export const EXTERNAL_API_READS_PER_MINUTE = 60;
export const EXTERNAL_API_WRITES_PER_MINUTE = 20;
