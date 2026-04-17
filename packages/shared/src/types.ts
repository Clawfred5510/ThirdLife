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
  BUY_PROPERTY = 'buy_property',
  CREDITS_UPDATE = 'credits_update',
  PROPERTY_UPDATE = 'property_update',
  PLAYER_COLOR = 'player_color',
  FAST_TRAVEL = 'fast_travel',
  JOB_START = 'job_start',
  JOB_UPDATE = 'job_update',
  JOB_COMPLETE = 'job_complete',
  JOB_BOARD = 'job_board',
  TUTORIAL = 'tutorial',
  CLAIM_PARCEL = 'claim_parcel',
  UPDATE_BUSINESS = 'update_business',
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
  TRADE = 'trade',
  TRADE_RESULT = 'trade_result',
  RESOURCE_UPDATE = 'resource_update',
  MARKET_PRICES = 'market_prices',
  EXPLORE = 'explore',
  EVENTS = 'events',
  EVENT = 'event',
  LEADERBOARD = 'leaderboard',
}

export interface PlayerResources {
  food: number;
  materials: number;
  energy: number;
  luxury: number;
}
