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

export enum MessageType {
  PLAYER_INPUT = 'player_input',
  CHAT = 'chat',
  BUILD = 'build',
  INTERACT = 'interact',
}
