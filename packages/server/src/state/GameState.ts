import { Schema } from '@colyseus/schema';

/**
 * Empty Colyseus schema. We intentionally avoid MapSchema / nested Schema
 * because @colyseus/schema@2.0.37 (legacy, matching colyseus@0.15) has a
 * reflection decoder bug ("refId not found") that prevents state sync on
 * the client. All game state (players, parcels) is synced via plain
 * messages instead — see GameRoom for the message contract.
 */
export class GameState extends Schema {}

// Plain player-data type used in server-side Maps.
export interface PlayerData {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
  credits: number;
  color: string;
}
