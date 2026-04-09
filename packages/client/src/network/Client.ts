import { Client, Room } from 'colyseus.js';
import { DEFAULT_SERVER_PORT } from '@gamestu/shared';

const SERVER_URL = `ws://localhost:${DEFAULT_SERVER_PORT}`;

let client: Client | null = null;
let room: Room | null = null;

export async function connect(playerName: string): Promise<Room> {
  client = new Client(SERVER_URL);
  room = await client.joinOrCreate('game', { name: playerName });

  room.state.players.onAdd((player: any, sessionId: string) => {
    console.log(`Player joined: ${player.name} (${sessionId})`);
  });

  room.state.players.onRemove((_player: any, sessionId: string) => {
    console.log(`Player left: ${sessionId}`);
  });

  console.log(`Connected to room: ${room.roomId}`);
  return room;
}

export function getRoom(): Room | null {
  return room;
}

export function disconnect() {
  room?.leave();
  room = null;
  client = null;
}
