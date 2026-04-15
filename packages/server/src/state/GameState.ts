import { Schema, MapSchema, type } from '@colyseus/schema';

export class PlayerState extends Schema {
  @type('string') id: string = '';
  @type('string') name: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('number') z: number = 0;
  @type('number') rotation: number = 0;
  @type('number') credits: number = 500;
  @type('string') color: string = '#3366cc';
}

// NOTE: parcels are intentionally NOT in the schema. Syncing 2,500 MapSchema
// entries on join broke the client-side reflection decoder ("refId not found").
// Parcels are pushed on join via `MessageType.PARCEL_STATE` and
// per-parcel updates via `MessageType.PARCEL_UPDATE` broadcasts.
export class GameState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
