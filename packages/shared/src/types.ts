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
}
