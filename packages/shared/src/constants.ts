import type { Appearance, HatStyle, AccessoryStyle } from './types';
import { LAND_COST_AMETA, STARTING_BALANCE_AMETA } from './pricing';

export const TICK_RATE = 20; // Server ticks per second
export const WORLD_SIZE = 2152; // World dimensions in units (45*40 + 44*8 = 2152)
export const MAX_PLAYERS_PER_ROOM = 50;
/** Base walking speed in world units per second. */
export const PLAYER_SPEED = 10;
/** Multiplier applied to PLAYER_SPEED while Shift is held. */
export const SPRINT_MULTIPLIER = 2;
export const DEFAULT_SERVER_PORT = 2567;
export const GAME_NAME = 'ThirdLife';
export const WORLD_HALF = WORLD_SIZE / 2; // 1076
export const CURRENCY_NAME = 'AMETA';
/** @deprecated use LAND_COST_AMETA from pricing.ts */
export const CLAIM_COST = LAND_COST_AMETA;
/** @deprecated use LAND_COST_AMETA from pricing.ts */
export const LAND_COST = LAND_COST_AMETA;
/** @deprecated use STARTING_BALANCE_AMETA from pricing.ts */
export const STARTING_BALANCE = STARTING_BALANCE_AMETA;
export const GRID_COLS = 45;
export const GRID_ROWS = 45;

/** Per-cell footprint (the buildable square inside a parcel). */
export const CELL_SIZE = 40;
/** Road width between cells. */
export const ROAD_WIDTH = 8;
/** Distance between adjacent parcel centres (cell + road). */
export const PARCEL_STRIDE = CELL_SIZE + ROAD_WIDTH;
/** Total grid extent in world units. Matches WORLD_SIZE. */
export const GRID_TOTAL_W = GRID_COLS * CELL_SIZE + (GRID_COLS - 1) * ROAD_WIDTH;
export const GRID_TOTAL_H = GRID_ROWS * CELL_SIZE + (GRID_ROWS - 1) * ROAD_WIDTH;

/**
 * World-space centre of a parcel given its grid coordinates. Canonical
 * formula used by both client (rendering buildings) and server (agent
 * positions, EXPLORE teleport, autopilot targets). Keep them in sync —
 * before this util existed, the server used `grid * 48 - 1200 + 20`
 * (correct for a 50×50 grid) while the client used the 45×45 form,
 * so agent teleports landed ~124 units away from the visible parcel.
 */
export function parcelWorldPos(grid_x: number, grid_y: number): { x: number; z: number } {
  return {
    x: grid_x * PARCEL_STRIDE - GRID_TOTAL_W / 2 + CELL_SIZE / 2,
    z: grid_y * PARCEL_STRIDE - GRID_TOTAL_H / 2 + CELL_SIZE / 2,
  };
}

/** How far south (−z) of a parcel's centre an agent stands so it's visibly in
 *  front of the building's door rather than embedded in the wall. */
export const DOOR_OFFSET_Z = 12;

/** Canonical "door" position for a parcel: world centre offset 12u south.
 *  THE single source for where an agent stands at its worksite — used by the
 *  autopilot waypoint, GameRoom agent placement, and REST agent spawn, so all
 *  three agree exactly (no jitter, no duplicated offset literal). */
export function parcelDoorPos(grid_x: number, grid_y: number): { x: number; y: number; z: number } {
  const { x, z } = parcelWorldPos(grid_x, grid_y);
  return { x, y: 0, z: z - DOOR_OFFSET_Z };
}

// ── Phase D world map: landmarks ──────────────────────────────────────

export interface LandmarkSpec {
  id: string;
  type: 'town_hall' | 'plaza' | 'monument' | 'gate' | 'park' | 'harbor';
  parcelId: number;
  name: string;
  description: string;
}

const gridId = (gx: number, gy: number): number => gx * GRID_COLS + gy;

/** Landmarks anchored to specific parcels. Their parcel IDs are also
 *  reserved (unclaimable). The center-of-map town hall is the existing
 *  rocket centerpiece. */
export const LANDMARKS: readonly LandmarkSpec[] = [
  { id: 'town_hall_central', type: 'town_hall', parcelId: gridId(22, 22), name: 'Town Hall (Rocket Plaza)',
    description: 'The seat of the world — a soaring rocket centerpiece. Civic ceremonies happen here.' },
  { id: 'gate_north', type: 'gate', parcelId: gridId(22, 0),
    name: 'North Gate', description: 'Ceremonial entrance from the north.' },
  { id: 'gate_south', type: 'gate', parcelId: gridId(22, 44),
    name: 'South Gate', description: 'Southern entrance to the city.' },
  { id: 'monument_e', type: 'monument', parcelId: gridId(38, 22),
    name: 'Founders Monument', description: 'Bronze obelisk honoring the first settlers.' },
  { id: 'park_w', type: 'park', parcelId: gridId(6, 22),
    name: 'Lakeside Park', description: 'Open green for picnics and celebrations.' },
  { id: 'harbor_sw', type: 'harbor', parcelId: gridId(2, 42),
    name: 'Harbor', description: 'Working docks at the southwest waterfront.' },
];

/**
 * Parcels reserved for world landmarks. Server rejects claim attempts on
 * these IDs; client hides their parcel markers / claim UI.
 */
export const RESERVED_PARCEL_IDS: readonly number[] = LANDMARKS.map((l) => l.parcelId);

// ── Building types ──────────────────────────────────────────────────────
//
// Every building has a `category` and a `tier`. The 25 tier-classified
// types form the 5×5 grid the spec describes (food / materials / energy
// / luxury-housing / luxury-civic at Bronze..Diamond). 'factory' is the
// canonical Tier-I energy type name retained from the legacy schema
// because parcels store the slug; the label says "Coal Power Plant"
// per spec §7.

export type BuildingType =
  // ── Food chain (Bronze → Diamond) ────────────────────────────────
  | 'farm' | 'ranch' | 'hydroponic_tower' | 'vertical_farm_complex' | 'synthetic_protein_lab'
  // ── Materials chain ──────────────────────────────────────────────
  | 'mine' | 'blacksmith' | 'refinery' | 'composite_plant' | 'chip_manufacturing'
  // ── Energy chain ─────────────────────────────────────────────────
  | 'factory' | 'wind_farm' | 'solar_farm' | 'nuclear_plant' | 'cold_fusion_facility'
  // ── Luxury Housing ───────────────────────────────────────────────
  | 'apartment' | 'house' | 'duplex' | 'villa' | 'mansion'
  // ── Luxury Civic ─────────────────────────────────────────────────
  | 'office' | 'market' | 'bank' | 'town_hall' | 'gala_hall';

export type ResourceType = 'food' | 'materials' | 'energy' | 'luxury';

export type BuildingCategory =
  | 'food' | 'materials' | 'energy'
  | 'luxury-housing' | 'luxury-civic';

import {
  PRODUCTION_BUILDING_AMETA_COST,
  PRODUCTION_BUILDING_MATERIAL_COST,
  LUXURY_BUILDING_AMETA_COST,
  LUXURY_BUILDING_MATERIAL_COST,
  type Tier,
} from './pricing';

export interface BuildingSpec {
  type: BuildingType;
  category: BuildingCategory;
  /** 1..5 (Bronze..Diamond). */
  tier: 1 | 2 | 3 | 4 | 5;
  /** Minimum player rank required to construct. 'bronze' for Tier I. */
  minRank: Tier;
  cost: number;
  /** Materials required at construction time, in addition to cost. */
  materialCost: number;
  /** Resource produced by this building (food/materials/energy chain
   *  buildings only). Luxury housing/civic emit passive luxury via
   *  LUXURY_PASSIVE_PER_TICK_BY_TIER instead. */
  produces?: ResourceType;
  /** Units of `produces` minted per produce-role agent tick. */
  amount?: number;
  label: string;
}

/** Tier index helper for the cost arrays — `tier 1 → idx 0`. */
function tCost(prodOrLux: 'prod' | 'lux', tier: 1 | 2 | 3 | 4 | 5): { cost: number; materialCost: number } {
  const idx = tier - 1;
  if (prodOrLux === 'prod') {
    return {
      cost: PRODUCTION_BUILDING_AMETA_COST[idx],
      materialCost: PRODUCTION_BUILDING_MATERIAL_COST[idx],
    };
  }
  return {
    cost: LUXURY_BUILDING_AMETA_COST[idx],
    materialCost: LUXURY_BUILDING_MATERIAL_COST[idx],
  };
}

/** Minimum player rank for each tier, indexed by tier number. */
const TIER_MIN_RANK: Record<1 | 2 | 3 | 4 | 5, Tier> = {
  1: 'bronze', 2: 'silver', 3: 'gold', 4: 'platinum', 5: 'diamond',
};

export const BUILDINGS: Record<BuildingType, BuildingSpec> = {
  // ── Food chain ───────────────────────────────────────────────────
  farm:                  { type: 'farm',                  category: 'food', tier: 1, minRank: TIER_MIN_RANK[1], ...tCost('prod', 1), produces: 'food', amount: 1, label: 'Farm' },
  ranch:                 { type: 'ranch',                 category: 'food', tier: 2, minRank: TIER_MIN_RANK[2], ...tCost('prod', 2), produces: 'food', amount: 2, label: 'Ranch' },
  hydroponic_tower:      { type: 'hydroponic_tower',      category: 'food', tier: 3, minRank: TIER_MIN_RANK[3], ...tCost('prod', 3), produces: 'food', amount: 3, label: 'Hydroponic Tower' },
  vertical_farm_complex: { type: 'vertical_farm_complex', category: 'food', tier: 4, minRank: TIER_MIN_RANK[4], ...tCost('prod', 4), produces: 'food', amount: 5, label: 'Vertical Farm Complex' },
  synthetic_protein_lab: { type: 'synthetic_protein_lab', category: 'food', tier: 5, minRank: TIER_MIN_RANK[5], ...tCost('prod', 5), produces: 'food', amount: 10, label: 'Synthetic Protein Lab' },

  // ── Materials chain ──────────────────────────────────────────────
  mine:               { type: 'mine',               category: 'materials', tier: 1, minRank: TIER_MIN_RANK[1], ...tCost('prod', 1), produces: 'materials', amount: 1, label: 'Mine' },
  blacksmith:         { type: 'blacksmith',         category: 'materials', tier: 2, minRank: TIER_MIN_RANK[2], ...tCost('prod', 2), produces: 'materials', amount: 2, label: 'Blacksmith' },
  refinery:           { type: 'refinery',           category: 'materials', tier: 3, minRank: TIER_MIN_RANK[3], ...tCost('prod', 3), produces: 'materials', amount: 3, label: 'Refinery' },
  composite_plant:    { type: 'composite_plant',    category: 'materials', tier: 4, minRank: TIER_MIN_RANK[4], ...tCost('prod', 4), produces: 'materials', amount: 5, label: 'Composite Plant' },
  chip_manufacturing: { type: 'chip_manufacturing', category: 'materials', tier: 5, minRank: TIER_MIN_RANK[5], ...tCost('prod', 5), produces: 'materials', amount: 10, label: 'Chip Manufacturing Plant' },

  // ── Energy chain ─────────────────────────────────────────────────
  // `factory` is retained as the canonical Tier-I energy type name to
  // avoid a DB migration of building_type for existing parcels. The label
  // says "Coal Power Plant" per spec §7.
  factory:              { type: 'factory',              category: 'energy', tier: 1, minRank: TIER_MIN_RANK[1], ...tCost('prod', 1), produces: 'energy', amount: 1, label: 'Coal Power Plant' },
  wind_farm:            { type: 'wind_farm',            category: 'energy', tier: 2, minRank: TIER_MIN_RANK[2], ...tCost('prod', 2), produces: 'energy', amount: 2, label: 'Wind Farm' },
  solar_farm:           { type: 'solar_farm',           category: 'energy', tier: 3, minRank: TIER_MIN_RANK[3], ...tCost('prod', 3), produces: 'energy', amount: 3, label: 'Solar Farm' },
  nuclear_plant:        { type: 'nuclear_plant',        category: 'energy', tier: 4, minRank: TIER_MIN_RANK[4], ...tCost('prod', 4), produces: 'energy', amount: 5, label: 'Nuclear Plant' },
  cold_fusion_facility: { type: 'cold_fusion_facility', category: 'energy', tier: 5, minRank: TIER_MIN_RANK[5], ...tCost('prod', 5), produces: 'energy', amount: 10, label: 'Cold Fusion Facility' },

  // ── Luxury Housing ───────────────────────────────────────────────
  apartment: { type: 'apartment', category: 'luxury-housing', tier: 1, minRank: TIER_MIN_RANK[1], ...tCost('lux', 1), label: 'Apartment' },
  house:     { type: 'house',     category: 'luxury-housing', tier: 2, minRank: TIER_MIN_RANK[2], ...tCost('lux', 2), label: 'House' },
  duplex:    { type: 'duplex',    category: 'luxury-housing', tier: 3, minRank: TIER_MIN_RANK[3], ...tCost('lux', 3), label: 'Duplex' },
  villa:     { type: 'villa',     category: 'luxury-housing', tier: 4, minRank: TIER_MIN_RANK[4], ...tCost('lux', 4), label: 'Villa' },
  mansion:   { type: 'mansion',   category: 'luxury-housing', tier: 5, minRank: TIER_MIN_RANK[5], ...tCost('lux', 5), label: 'Mansion' },

  // ── Luxury Civic ─────────────────────────────────────────────────
  office:    { type: 'office',    category: 'luxury-civic', tier: 1, minRank: TIER_MIN_RANK[1], ...tCost('lux', 1), label: 'Office' },
  market:    { type: 'market',    category: 'luxury-civic', tier: 2, minRank: TIER_MIN_RANK[2], ...tCost('lux', 2), label: 'Market' },
  bank:      { type: 'bank',      category: 'luxury-civic', tier: 3, minRank: TIER_MIN_RANK[3], ...tCost('lux', 3), label: 'Bank' },
  town_hall: { type: 'town_hall', category: 'luxury-civic', tier: 4, minRank: TIER_MIN_RANK[4], ...tCost('lux', 4), label: 'Town Hall' },
  gala_hall: { type: 'gala_hall', category: 'luxury-civic', tier: 5, minRank: TIER_MIN_RANK[5], ...tCost('lux', 5), label: 'Gala Hall' },
};

/** True if `type` is a player-constructable v1 building. All current
 *  BuildingType values are tier-classified, so this is always true —
 *  kept as a stable predicate for callers that still gate on it. */
export function isTieredBuilding(type: BuildingType): boolean {
  return BUILDINGS[type] != null;
}

/** True if this building consumes 1 energy/tick to produce its resource.
 *
 *  Energy buildings (category='energy') are SELF-POWERED per owner
 *  direction 2026-05-20 — they're in the producers loop (they still
 *  benefit from agents + tier multipliers + crafting) but they bypass
 *  the energy stockpile gate. The tick code reads this flag to decide
 *  which producers to gate. See requiresExternalPower below for the
 *  gate-check variant.
 */
export function consumesEnergy(type: BuildingType): boolean {
  const c = BUILDINGS[type].category;
  return c === 'food' || c === 'materials' || c === 'energy';
}

/** Subset of consumesEnergy that excludes self-powered energy buildings.
 *  Used by the tick body when computing how many producers compete for
 *  the player's energy stockpile. Energy buildings still produce, but
 *  they don't draw from the pool. */
export function requiresExternalPower(type: BuildingType): boolean {
  const c = BUILDINGS[type].category;
  return c === 'food' || c === 'materials';
}

/** True if this building emits passive luxury per tick (Housing or Civic). */
export function emitsPassiveLuxury(type: BuildingType): boolean {
  const c = BUILDINGS[type].category;
  return c === 'luxury-housing' || c === 'luxury-civic';
}

export const BUILDING_LIST: BuildingSpec[] = Object.values(BUILDINGS);
export const RESOURCE_TYPES: ResourceType[] = ['food', 'materials', 'energy', 'luxury'];

// ── Luxury items catalog (spec §4) ─────────────────────────────────────
// 15 named, tradeable items. One per production building. A craft agent
// at building B mints items_per_tick (= tier_multiplier) units of B's
// item per tick, consuming CRAFT_RESOURCES_PER_ITEM × items_per_tick of
// B's input resource. Each item burns for tier-specific rank points.

export type LuxuryItemKind =
  // Food chain
  | 'artisan_jam' | 'aged_charcuterie' | 'heirloom_truffle' | 'imperial_caviar' | 'designer_wagyu'
  // Materials chain
  | 'cut_gemstone' | 'forged_sculpture' | 'polished_marble' | 'carbon_weave' | 'quantum_display'
  // Energy chain
  | 'aaa_battery' | 'aa_battery' | '9v_battery' | 'industrial_cell' | 'fusion_core';

export interface LuxuryItemSpec {
  kind: LuxuryItemKind;
  /** Production building that crafts this item (1:1 mapping). */
  building: BuildingType;
  /** Input resource consumed at CRAFT_RESOURCES_PER_ITEM each. */
  chain: 'food' | 'materials' | 'energy';
  /** Tier of the source building. Determines items-per-tick and burn value. */
  tier: 1 | 2 | 3 | 4 | 5;
  /** Rank points granted per item burned. */
  burnValue: number;
  /** Display label shown in inventory + marketplace. */
  label: string;
}

export const LUXURY_ITEMS: Record<LuxuryItemKind, LuxuryItemSpec> = {
  // Food chain
  artisan_jam:       { kind: 'artisan_jam',       building: 'farm',                  chain: 'food',      tier: 1, burnValue: 1,  label: 'Artisan Jam' },
  aged_charcuterie:  { kind: 'aged_charcuterie',  building: 'ranch',                 chain: 'food',      tier: 2, burnValue: 3,  label: 'Aged Charcuterie Board' },
  heirloom_truffle:  { kind: 'heirloom_truffle',  building: 'hydroponic_tower',      chain: 'food',      tier: 3, burnValue: 6,  label: 'Heirloom Truffle Box' },
  imperial_caviar:   { kind: 'imperial_caviar',   building: 'vertical_farm_complex', chain: 'food',      tier: 4, burnValue: 12, label: 'Imperial Caviar' },
  designer_wagyu:    { kind: 'designer_wagyu',    building: 'synthetic_protein_lab', chain: 'food',      tier: 5, burnValue: 25, label: 'Designer Wagyu Reserve' },
  // Materials chain
  cut_gemstone:      { kind: 'cut_gemstone',      building: 'mine',                  chain: 'materials', tier: 1, burnValue: 1,  label: 'Cut Gemstone' },
  forged_sculpture:  { kind: 'forged_sculpture',  building: 'blacksmith',            chain: 'materials', tier: 2, burnValue: 3,  label: 'Forged Sculpture' },
  polished_marble:   { kind: 'polished_marble',   building: 'refinery',              chain: 'materials', tier: 3, burnValue: 6,  label: 'Polished Marble Bust' },
  carbon_weave:      { kind: 'carbon_weave',      building: 'composite_plant',       chain: 'materials', tier: 4, burnValue: 12, label: 'Carbon-Weave Art Piece' },
  quantum_display:   { kind: 'quantum_display',   building: 'chip_manufacturing',    chain: 'materials', tier: 5, burnValue: 25, label: 'Quantum-Etched Display' },
  // Energy chain (all batteries)
  aaa_battery:       { kind: 'aaa_battery',       building: 'factory',               chain: 'energy',    tier: 1, burnValue: 1,  label: 'AAA Battery' },
  aa_battery:        { kind: 'aa_battery',        building: 'wind_farm',             chain: 'energy',    tier: 2, burnValue: 3,  label: 'AA Battery' },
  '9v_battery':      { kind: '9v_battery',        building: 'solar_farm',            chain: 'energy',    tier: 3, burnValue: 6,  label: '9V Battery' },
  industrial_cell:   { kind: 'industrial_cell',   building: 'nuclear_plant',         chain: 'energy',    tier: 4, burnValue: 12, label: 'Industrial Power Cell' },
  fusion_core:       { kind: 'fusion_core',       building: 'cold_fusion_facility',  chain: 'energy',    tier: 5, burnValue: 25, label: 'Fusion Core' },
};

export const LUXURY_ITEM_KINDS: LuxuryItemKind[] = Object.keys(LUXURY_ITEMS) as LuxuryItemKind[];

/** Map a production building back to the item it crafts. Used by the
 *  crafting tick to look up output kind per parcel. */
export const ITEM_FOR_BUILDING: Partial<Record<BuildingType, LuxuryItemKind>> = (() => {
  const out: Partial<Record<BuildingType, LuxuryItemKind>> = {};
  for (const spec of Object.values(LUXURY_ITEMS)) out[spec.building] = spec.kind;
  return out;
})();

/** True if the string is one of the 4 base RESOURCE_TYPES. */
export function isResourceType(s: string): s is ResourceType {
  return RESOURCE_TYPES.includes(s as ResourceType);
}

/** True if the string is one of the 15 LuxuryItemKind values. */
export function isLuxuryItemKind(s: string): s is LuxuryItemKind {
  return s in LUXURY_ITEMS;
}

/** Marketplace order kind: a resource or a luxury item, validated. */
export type MarketKind = ResourceType | LuxuryItemKind;
export function isMarketKind(s: string): s is MarketKind {
  return isResourceType(s) || isLuxuryItemKind(s);
}

// Legacy market prices kept for any caller that still hardcodes them.
// New code should use NPC_SEED_PRICE_AMETA from pricing.ts (10× lower —
// the locked v1 anchor prices are 50/100/150/250).
/** @deprecated use NPC_SEED_PRICE_AMETA from pricing.ts */
export const BASE_MARKET_PRICES: Record<ResourceType, number> = {
  food: 500,
  materials: 1000,
  energy: 1500,
  luxury: 2500,
};

// FOOD_PER_AGENT_PER_TICK lives in pricing.ts (re-exported by index.ts).

// ── Legacy agent personality/strategy enums ──────────────────────────────
// AgentRole (work/produce/craft) in pricing.ts is the canonical model. The
// personality/strategy types below exist only to keep legacy REST callers
// alive — /api/v1/agents/register still accepts and stores these fields
// for back-compat, but no code branches on them anymore.
export type AgentPersonality = 'trader' | 'builder' | 'ambitious' | 'social' | 'accumulator' | 'worker';
export type AgentStrategy = 'aggressive' | 'balanced' | 'conservative';
export const AGENT_PERSONALITIES: AgentPersonality[] = ['trader', 'builder', 'ambitious', 'social', 'accumulator', 'worker'];
export const AGENT_STRATEGIES: AgentStrategy[] = ['aggressive', 'balanced', 'conservative'];

// ── Jobs (player-facing) ────────────────────────────────────────────────
//
// A Job is the player-facing concept the owner picks when creating an
// agent. It maps to a personality + strategy and (optionally) a required
// building type that determines where the agent stands and works.
//
// Hats and accessories come from the same enums the human Closet uses;
// the job appearance override just sets fields the player would otherwise
// see in their wardrobe. No new 3D assets required.

export type JobId =
  | 'farmer' | 'miner' | 'factory_worker' | 'shopkeeper'
  | 'trader' | 'builder' | 'banker' | 'greeter';

export interface JobSpec {
  id: JobId;
  label: string;
  icon: string;
  /** One-sentence summary used in the create flow. */
  summary: string;
  personality: AgentPersonality;
  strategy: AgentStrategy;
  /** If set, agent must be stationed at a parcel with this building type. */
  requires_building?: BuildingType;
  /** Hat + accessory overrides applied on top of the owner's appearance. */
  hat_style: HatStyle;
  hat_color: string;
  accessory_style?: AccessoryStyle;
  accessory_color?: string;
}

export const JOBS: Record<JobId, JobSpec> = {
  farmer: {
    id: 'farmer', label: 'Farmer', icon: '🌾',
    summary: 'Works a farm parcel. Produces food each tick.',
    personality: 'worker', strategy: 'balanced',
    requires_building: 'farm',
    hat_style: 'cap', hat_color: '#8a5a3b',
  },
  miner: {
    id: 'miner', label: 'Miner', icon: '⛏️',
    summary: 'Works a mine parcel. Produces materials each tick.',
    personality: 'worker', strategy: 'balanced',
    requires_building: 'mine',
    hat_style: 'cap', hat_color: '#ecc94b',
  },
  factory_worker: {
    id: 'factory_worker', label: 'Factory Worker', icon: '🏭',
    summary: 'Works a factory. Produces energy each tick.',
    personality: 'worker', strategy: 'balanced',
    requires_building: 'factory',
    hat_style: 'cap', hat_color: '#ed8936',
  },
  shopkeeper: {
    id: 'shopkeeper', label: 'Shopkeeper', icon: '🛍️',
    summary: 'Runs an office. Produces luxury goods each tick.',
    personality: 'worker', strategy: 'balanced',
    requires_building: 'office',
    hat_style: 'beanie', hat_color: '#f5e6d0',
  },
  trader: {
    id: 'trader', label: 'Trader', icon: '📈',
    summary: 'Places limit orders on the market. No workplace needed.',
    personality: 'trader', strategy: 'balanced',
    hat_style: 'tophat', hat_color: '#2a5560',
  },
  builder: {
    id: 'builder', label: 'Builder', icon: '🏗️',
    summary: 'Claims unclaimed parcels and builds. Roams the world.',
    personality: 'builder', strategy: 'aggressive',
    hat_style: 'cap', hat_color: '#dc2626',
  },
  banker: {
    id: 'banker', label: 'Banker', icon: '🏦',
    summary: 'Hoards $AMETA. Passive yield from net worth.',
    personality: 'accumulator', strategy: 'conservative',
    hat_style: 'tophat', hat_color: '#111111',
    accessory_style: 'bowtie', accessory_color: '#dc2626',
  },
  greeter: {
    id: 'greeter', label: 'Greeter', icon: '👋',
    summary: 'Greets newcomers near spawn. Cosmetic — no income.',
    personality: 'social', strategy: 'conservative',
    hat_style: 'beanie', hat_color: '#3F7A3D',
  },
};

export const JOB_IDS: JobId[] = Object.keys(JOBS) as JobId[];

/** Build an Appearance for a new agent by cloning the owner's look and
 *  applying the job's hat (and accessory, if specified). */
export function applyJobLook(owner: Appearance, job: JobId): Appearance {
  const spec = JOBS[job];
  const next: Appearance = { ...owner, hat_style: spec.hat_style, hat_color: spec.hat_color };
  if (spec.accessory_style) {
    next.accessory_style = spec.accessory_style;
    if (spec.accessory_color) next.accessory_color = spec.accessory_color;
  }
  return next;
}

/** Re-exported from pricing.ts (TICK_LENGTH_MS = 10 minutes locked).
 *  Server reads `process.env.TICK_LENGTH_MS` if set for dev overrides. */
import { TICK_LENGTH_MS } from './pricing';
export const INCOME_TICK_MS = TICK_LENGTH_MS;

// ── Legacy fee constants ──────────────────────────────────────────────
// Both are replaced by canonical exports from pricing.ts. The trading fee
// becomes progressive by rank in Phase 4; for now the flat 1% (Bronze rate)
// keeps existing market math correct.
/** @deprecated use MARKETPLACE_FEE_BPS_BY_RANK from pricing.ts */
export const TRADING_FEE_BPS = 100;
// TRANSFER_FEE_BPS and BPS_DENOMINATOR are re-exported from pricing.ts.

/** Default world spawn point. New players are seeded here in the DB
 *  and the phone's "Spawn" app teleports back to it.
 *  z=-72 is the open road one parcel-row south of the rocket plaza — the
 *  player faces +Z straight at the rocket with the whole rocket in frame.
 *  (z=-80 used to land 4u INSIDE the buildable footprint of parcel (22,20),
 *  so new players appeared half-inside a building once that lot was built.) */
export const SPAWN_POINT = { x: 0, y: 0, z: -72 };

export const BUS_STOPS = [
  { name: 'Downtown Central', x: 450, z: -250 },
  { name: 'Residential Park', x: -500, z: 500 },
  { name: 'Industrial Yard', x: 500, z: 550 },
  { name: 'Waterfront Marina', x: 700, z: -750 },
  { name: 'Entertainment Stage', x: -500, z: -250 },
];

// ── Rendering / camera constants (client-only, kept in shared for testability)

/** Exponential squared fog density across the world plane. */
export const FOG_DENSITY = 0.0012;

/** Warm pastel sky base color (r,g,b in 0..1). Day/night cycle overrides. */
export const SKY_COLOR = { r: 0.62, g: 0.82, b: 0.95 };

/** Camera zoom limits in world units, initial ArcRotate + follow-cam. */
export const CAMERA_INITIAL_MIN_ZOOM = 5;
export const CAMERA_INITIAL_MAX_ZOOM = 100;
export const CAMERA_FOLLOW_MIN_ZOOM = 4;
export const CAMERA_FOLLOW_MAX_ZOOM = 40;

/** Full day/night cycle duration in seconds. */
export const DAY_CYCLE_SECONDS = 600;

/** Network interpolation LERP factor for remote players (0..1).
 *  Used only for remote-avatar YAW smoothing now — position uses exact
 *  buffered interpolation (see sampleSnapshot). */
export const REMOTE_PLAYER_LERP = 0.2;

/**
 * How far behind real time (ms) remote avatars are rendered. We interpolate
 * BETWEEN the two most recent server snapshots at this delay, so two real
 * snapshots almost always bracket the render time even under network jitter.
 * Set to ~1.3× the 100 ms server broadcast interval (PLAYER_BROADCAST_
 * INTERVAL_MS in GameRoom). The trade is ~130 ms of remote-avatar visual
 * latency (invisible in normal play) in exchange for never extrapolating
 * past the authoritative position — which is what left stopped remote
 * players permanently off-position before 2026-05-31. Per network-code.md:
 * remote avatars use server interpolation only, no prediction.
 */
export const INTERP_DELAY_MS = 130;

/**
 * Buffered snapshot-interpolation sample for one axis of a remote player.
 * Linearly interpolates between the previous snapshot (`prev`, arrived at
 * `prevAt`) and the latest (`next`, arrived at `nextAt`) for the given
 * `renderTime` (= now − INTERP_DELAY_MS). The interpolation factor is
 * clamped to [0, 1], so:
 *   - renderTime before prevAt  → returns `prev`  (buffer not yet caught up)
 *   - renderTime after  nextAt  → returns `next`  (NO newer snapshot, e.g.
 *                                  the player stopped) → holds EXACTLY at the
 *                                  authoritative position, never overshoots.
 * A zero/negative span (only one snapshot seen, or duplicate timestamps)
 * returns `next` so a freshly-spawned avatar renders at its reported spot.
 * Pure + frame-rate independent so it can be unit-tested without Babylon.
 */
export function sampleSnapshot(
  prev: number,
  next: number,
  prevAt: number,
  nextAt: number,
  renderTime: number,
): number {
  const span = nextAt - prevAt;
  if (span <= 0) return next;
  const t = Math.min(Math.max((renderTime - prevAt) / span, 0), 1);
  return prev + (next - prev) * t;
}

// ── Avatar animation constants ──────────────────────────────────────────

/** World units/s below which the avatar shows the idle animation, not walk. */
export const AVATAR_WALK_SPEED_THRESHOLD = 0.5;
/** Walk cycle frequency (steps per second). */
export const AVATAR_WALK_FREQ = 8;
/** Peak leg swing in radians during walk cycle. */
export const AVATAR_WALK_LEG_SWING = 0.4;
/** Peak arm swing in radians during walk cycle. */
export const AVATAR_WALK_ARM_SWING = 0.35;
/** Body vertical bob amplitude while walking (world units). */
export const AVATAR_WALK_BOB = 0.04;
/** Body vertical bob amplitude while idling (world units). */
export const AVATAR_IDLE_BOB = 0.012;
/** Idle breathing frequency (cycles per second). */
export const AVATAR_IDLE_FREQ = 1.5;
