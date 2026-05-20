import type { Appearance, HatStyle, AccessoryStyle } from './types';

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
export const CLAIM_COST = 150000;      // same as LAND_COST
export const LAND_COST = 150000;
export const STARTING_BALANCE = 50;
export const EXPLORE_COST = 69;
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

// ── Phase D world map: zones + landmarks + premium parcels ────────────

export type Zone =
  | 'downtown' | 'commercial' | 'residential' | 'industrial' | 'tech'
  | 'agricultural' | 'waterfront' | 'park' | 'public' | 'wilderness';

export const ZONE_COLORS: Record<Zone, string> = {
  downtown:     '#ffb86b',
  commercial:   '#fde047',
  residential:  '#86efac',
  industrial:   '#a3a3a3',
  tech:         '#a78bfa',
  agricultural: '#65a30d',
  waterfront:   '#38bdf8',
  park:         '#22c55e',
  public:       '#94a3b8',
  wilderness:   '#3f3f46',
};

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

/** Per-zone building cost multiplier — downtown costs more, residential
 *  is cheaper. Multiplier of 1.0 means no change. */
export const ZONE_COST_MULTIPLIER: Record<Zone, number> = {
  downtown:     1.20,
  commercial:   1.10,
  residential:  0.90,
  industrial:   1.00,
  tech:         1.05,
  agricultural: 0.85,
  waterfront:   1.05,
  park:         1.00,
  public:       1.00,
  wilderness:   0.80,
};

/** Per-zone income multiplier on building income tick. */
export const ZONE_INCOME_MULTIPLIER: Record<Zone, number> = {
  downtown:     1.20,
  commercial:   1.10,
  residential:  1.00,
  industrial:   1.05,
  tech:         1.15,
  agricultural: 1.00,
  waterfront:   1.10,
  park:         0.90,
  public:       1.00,
  wilderness:   0.85,
};

/** Premium-parcel income bonus stacks on top of the zone multiplier. */
export const PREMIUM_INCOME_BONUS = 1.15;

/**
 * Static zone classifier from grid position. Center 5×5 = downtown,
 * surrounding ring = commercial, then residential/industrial/etc.
 * Pure function, no DB lookup — both server and client compute
 * identically.
 */
export function zoneForGrid(gx: number, gy: number): Zone {
  const cx = Math.floor(GRID_COLS / 2);
  const cy = Math.floor(GRID_ROWS / 2);
  const dx = Math.abs(gx - cx);
  const dy = Math.abs(gy - cy);
  const ring = Math.max(dx, dy);

  if (ring <= 2) return 'downtown';
  if (ring <= 5) return 'commercial';
  if (ring <= 8) return 'tech';
  if (ring <= 12) return 'residential';

  // Outer ring sectors — split by quadrant for variety.
  const isLeft = gx < cx;
  const isTop = gy < cy;
  if (gy === 0 || gy === GRID_ROWS - 1 || gx === 0 || gx === GRID_COLS - 1) {
    if (gy === GRID_ROWS - 1 && isLeft) return 'waterfront';
    if (gy === 0) return 'public';
  }
  if (ring <= 17) {
    if (isTop && isLeft) return 'park';
    if (isTop) return 'industrial';
    if (isLeft) return 'agricultural';
    return 'commercial';
  }
  return 'wilderness';
}

/** Stable premium-parcel set: ~3% of parcels, deterministic from id.
 *  These get a +15% income modifier (gold-bordered on the minimap). */
export function isPremiumParcel(parcelId: number): boolean {
  // Hash mixing — picks a deterministic ~3% of ids without an explicit list.
  // Quick rule: id whose digits sum is a multiple of 13 (yields ~7% which
  // we further filter by parity).
  if (RESERVED_PARCEL_IDS.includes(parcelId)) return false;
  const h = ((parcelId * 2654435761) >>> 0) % 100;
  return h < 3;
}

// ── Building types ──────────────────────────────────────────────────────

export type BuildingType =
  | 'apartment' | 'house' | 'shop' | 'farm'
  | 'market' | 'office' | 'mine' | 'hall'
  | 'factory' | 'bank'
  // Phase D extended types — cosmetic + income tiers above the
  // original 10. Building meshes fall back to a generic procedural
  // box if a type-specific module isn't yet implemented.
  | 'skyscraper' | 'mall' | 'stadium'
  | 'hospital' | 'library' | 'station' | 'club';

export type ResourceType = 'food' | 'materials' | 'energy' | 'luxury';

export interface BuildingSpec {
  type: BuildingType;
  cost: number;
  income: number;       // passive credits per income tick (0 for resource buildings)
  produces?: ResourceType;
  amount?: number;      // resource produced per work action
  label: string;
}

export const BUILDINGS: Record<BuildingType, BuildingSpec> = {
  apartment: { type: 'apartment', cost: 50000,   income: 5,   label: 'Apartment' },
  house:     { type: 'house',     cost: 75000,   income: 7,   label: 'House' },
  shop:      { type: 'shop',      cost: 100000,  income: 0, produces: 'luxury',    amount: 0.5,  label: 'Shop' },
  farm:      { type: 'farm',      cost: 150000,  income: 0, produces: 'food',      amount: 1.25, label: 'Farm' },
  market:    { type: 'market',    cost: 200000,  income: 20,  label: 'Market' },
  office:    { type: 'office',    cost: 250000,  income: 15,  label: 'Office' },
  mine:      { type: 'mine',      cost: 300000,  income: 0, produces: 'materials', amount: 0.75, label: 'Mine' },
  hall:      { type: 'hall',      cost: 400000,  income: 40,  label: 'Hall' },
  factory:   { type: 'factory',   cost: 500000,  income: 0, produces: 'energy',    amount: 1.0,  label: 'Factory' },
  bank:      { type: 'bank',      cost: 2000000, income: 200, label: 'Bank' },
  // Phase D extended types
  skyscraper:{ type: 'skyscraper',cost: 5000000, income: 500, label: 'Skyscraper' },
  mall:      { type: 'mall',      cost: 3000000, income: 300, label: 'Mall' },
  stadium:   { type: 'stadium',   cost: 4000000, income: 250, label: 'Stadium' },
  hospital:  { type: 'hospital',  cost: 1500000, income: 100, label: 'Hospital' },
  library:   { type: 'library',   cost: 800000,  income: 60,  label: 'Library' },
  station:   { type: 'station',   cost: 600000,  income: 50,  label: 'Station' },
  club:      { type: 'club',      cost: 1000000, income: 80,  label: 'Club' },
};

export const BUILDING_LIST: BuildingSpec[] = Object.values(BUILDINGS);
export const RESOURCE_TYPES: ResourceType[] = ['food', 'materials', 'energy', 'luxury'];

// Base market prices (credits per unit of resource) — canonical per
// thirdlifeworld.xyz /docs. Keep in sync with the live spec.
export const BASE_MARKET_PRICES: Record<ResourceType, number> = {
  food: 500,
  materials: 1000,
  energy: 1500,
  luxury: 2500,
};

// ── Tick-based economy (per thirdlifeworld.xyz /docs) ────────────────────
// In addition to the manual WORK action (which awards `amount` per call),
// resource-producing buildings now auto-produce `tickRate` per income tick.
// Income-paying buildings require one energy per tick or they pay nothing.
// Every active agent consumes one food per tick; below zero, they stop
// producing (but stay in the game — inactive is a soft state).

export const TICK_PRODUCTION: Record<BuildingType, { resource: ResourceType; rate: number } | null> = {
  apartment: null,
  house: null,
  shop: { resource: 'luxury', rate: 2 },
  farm: { resource: 'food', rate: 5 },
  market: null,
  office: null,
  mine: { resource: 'materials', rate: 3 },
  hall: null,
  factory: { resource: 'energy', rate: 4 },
  bank: null,
  // Phase D extended types — pure income, no resource production.
  skyscraper: null,
  mall: null,
  stadium: null,
  hospital: null,
  library: null,
  station: null,
  club: null,
};

/** Food each active agent eats per tick. */
export const FOOD_PER_AGENT_PER_TICK = 1;

/** Energy each income-paying building burns per tick to actually pay out. */
export const ENERGY_PER_INCOME_BUILDING_PER_TICK = 1;

// Agent registration
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
    summary: 'Runs a shop. Produces luxury goods each tick.',
    personality: 'worker', strategy: 'balanced',
    requires_building: 'shop',
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

/** Infer a Job from a legacy (pre-jobs) personality. Used for migrating
 *  agents that pre-date the JOBS table. */
export function inferJobFromPersonality(p: AgentPersonality): JobId {
  switch (p) {
    case 'trader':      return 'trader';
    case 'builder':     return 'builder';
    case 'accumulator': return 'banker';
    case 'social':      return 'greeter';
    case 'ambitious':   return 'trader';
    case 'worker':
    default:            return 'farmer';
  }
}

export const INCOME_TICK_MS = 60000; // passive income every 60s

// ── Economy fees (basis points; 100 = 1%) ─────────────────────────────
// Match the canonical site's behavior — every autopilot trade event line
// shows a per-trade fee, every AMETA transfer shows a +X fee. Both flow
// to the world treasury (a special sink player ID).
export const TRADING_FEE_BPS = 100;   // 1% on resource sales
export const TRANSFER_FEE_BPS = 100;  // 1% on AMETA transfers between players
export const BPS_DENOMINATOR = 10000;

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

/** Network interpolation LERP factor for remote players (0..1). */
export const REMOTE_PLAYER_LERP = 0.2;

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
