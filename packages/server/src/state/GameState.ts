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

export class ParcelState extends Schema {
  @type('number') id: number = 0;
  @type('number') grid_x: number = 0;
  @type('number') grid_y: number = 0;
  @type('string') owner_id: string = '';
  @type('string') business_name: string = '';
  @type('string') business_type: string = '';
  @type('string') color: string = '#4a90d9';
  @type('number') height: number = 4;
}

export class GameState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: ParcelState }) parcels = new MapSchema<ParcelState>();
}
