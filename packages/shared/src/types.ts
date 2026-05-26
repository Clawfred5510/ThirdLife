export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlayerInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint?: boolean;
  rotation?: number; // facing direction in radians
}

export interface PlayerData {
  id: string;
  name: string;
  position: Vec3;
  rotation: number;
}

export interface BuildingData {
  id: string;
  ownerId: string;
  name: string;
  position: Vec3;
  type: string;
}

export interface ChatMessage {
  senderId: string;
  senderName: string;
  text: string;
}

export type HatStyle = 'none' | 'cap' | 'tophat' | 'beanie';
export type ShirtStyle = 'basic' | 'stripe' | 'vest';
export type PantsStyle = 'basic' | 'shorts';
export type ShoesStyle = 'basic' | 'boots';
export type AccessoryStyle = 'none' | 'chain' | 'sunglasses' | 'bowtie';

export interface Appearance {
  body_color: string;
  hat_style: HatStyle;
  hat_color: string;
  shirt_style: ShirtStyle;
  shirt_color: string;
  pants_style: PantsStyle;
  pants_color: string;
  shoes_style: ShoesStyle;
  shoes_color: string;
  accessory_style: AccessoryStyle;
  accessory_color: string;
}

export const DEFAULT_APPEARANCE: Appearance = {
  body_color: '#eac39e',
  hat_style: 'none',
  hat_color: '#222222',
  shirt_style: 'basic',
  shirt_color: '#3366cc',
  pants_style: 'basic',
  pants_color: '#222233',
  shoes_style: 'basic',
  shoes_color: '#1a1a1a',
  accessory_style: 'none',
  accessory_color: '#f0c040',
};

export interface ParcelData {
  id: number;
  grid_x: number;
  grid_y: number;
  owner_id: string;
  business_name: string;
  business_type: string;
  color: string;
  height: number;
}

export enum MessageType {
  PLAYER_INPUT = 'player_input',
  CHAT = 'chat',
  BUILD = 'build',
  INTERACT = 'interact',
  CREDITS_UPDATE = 'credits_update',
  PLAYER_COLOR = 'player_color',
  FAST_TRAVEL = 'fast_travel',
  RESPAWN = 'respawn',
  JOB_START = 'job_start',
  JOB_UPDATE = 'job_update',
  JOB_COMPLETE = 'job_complete',
  JOB_BOARD = 'job_board',
  TUTORIAL = 'tutorial',
  CLAIM_PARCEL = 'claim_parcel',
  UPDATE_BUSINESS = 'update_business',
  DEMOLISH_BUILDING = 'demolish_building',
  PARCEL_STATE = 'parcel_state',
  PARCEL_UPDATE = 'parcel_update',
  PLAYER_JOIN = 'player_join',
  PLAYER_LEAVE = 'player_leave',
  PLAYER_STATE = 'player_state',
  PLAYER_UPDATE = 'player_update',
  UPDATE_APPEARANCE = 'update_appearance',
  BUILD_STRUCTURE = 'build_structure',
  WORK = 'work',
  WORK_RESULT = 'work_result',
  // TRADE / TRADE_RESULT / MARKET_PRICES removed 2026-05-16 — all market
  // operations now go through the REST order book (/api/v1/market/*).
  RESOURCE_UPDATE = 'resource_update',
  EVENTS = 'events',
  EVENT = 'event',
  LEADERBOARD = 'leaderboard',
  // Phase 3 — luxury burn + item inventory sync
  BURN_LUXURY = 'burn_luxury',
  BURN_EFFECT = 'burn_effect',          // S→C broadcast for the particle effect
  ITEM_UPDATE = 'item_update',          // S→C player's luxury_items snapshot
  RANK_UP = 'rank_up',                  // S→C broadcast on rank promotion (Phase 4)
  // Phase 6 — offline accrual recap shown on login when the wallet has
  // missed > 0 ticks of passive income (wages + housing/civic luxury).
  OFFLINE_RECAP = 'offline_recap',
}

export interface PlayerResources {
  food: number;
  materials: number;
  energy: number;
  luxury: number;
}
