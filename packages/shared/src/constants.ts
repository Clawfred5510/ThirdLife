export const TICK_RATE = 20; // Server ticks per second
export const WORLD_SIZE = 2400; // World dimensions in units (grid ~2392 wide)
export const MAX_PLAYERS_PER_ROOM = 50;
/** Base walking speed in world units per second. */
export const PLAYER_SPEED = 10;
/** Multiplier applied to PLAYER_SPEED while Shift is held. */
export const SPRINT_MULTIPLIER = 2;
export const DEFAULT_SERVER_PORT = 2567;
export const GAME_NAME = 'ThirdLife';
export const WORLD_HALF = WORLD_SIZE / 2; // 1200
export const CURRENCY_NAME = 'AMETA';
export const CLAIM_COST = 150000;      // same as LAND_COST
export const LAND_COST = 150000;
export const STARTING_BALANCE = 50;
export const EXPLORE_COST = 69;
export const GRID_COLS = 50;
export const GRID_ROWS = 50;

// ── Building types ──────────────────────────────────────────────────────

export type BuildingType =
  | 'apartment' | 'house' | 'shop' | 'farm'
  | 'market' | 'office' | 'mine' | 'hall'
  | 'factory' | 'bank';

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
};

export const BUILDING_LIST: BuildingSpec[] = Object.values(BUILDINGS);
export const RESOURCE_TYPES: ResourceType[] = ['food', 'materials', 'energy', 'luxury'];

// Base market prices (credits per unit of resource)
export const BASE_MARKET_PRICES: Record<ResourceType, number> = {
  food: 500,
  materials: 800,
  energy: 1000,
  luxury: 2000,
};

// Agent registration
export type AgentPersonality = 'trader' | 'builder' | 'ambitious' | 'social' | 'accumulator' | 'worker';
export type AgentStrategy = 'aggressive' | 'balanced' | 'conservative';
export const AGENT_PERSONALITIES: AgentPersonality[] = ['trader', 'builder', 'ambitious', 'social', 'accumulator', 'worker'];
export const AGENT_STRATEGIES: AgentStrategy[] = ['aggressive', 'balanced', 'conservative'];

export const INCOME_TICK_MS = 60000; // passive income every 60s

export const BUS_STOPS = [
  { name: 'Downtown Central', x: 450, z: -250 },
  { name: 'Residential Park', x: -500, z: 500 },
  { name: 'Industrial Yard', x: 500, z: 550 },
  { name: 'Waterfront Marina', x: 700, z: -750 },
  { name: 'Entertainment Stage', x: -500, z: -250 },
];
