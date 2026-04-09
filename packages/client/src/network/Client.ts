import { Client, Room } from 'colyseus.js';
import { DEFAULT_SERVER_PORT, MessageType, PlayerInput, ChatMessage } from '@gamestu/shared';

const SERVER_URL = `ws://localhost:${DEFAULT_SERVER_PORT}`;

let client: Client | null = null;
let room: Room | null = null;

// ---------- Callback types ----------

export interface PlayerSnapshot {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
}

export type PlayerAddCallback = (sessionId: string, player: PlayerSnapshot) => void;
export type PlayerRemoveCallback = (sessionId: string) => void;
export type PlayerChangeCallback = (sessionId: string, player: PlayerSnapshot) => void;
export type ChatCallback = (message: ChatMessage) => void;

// ---------- Registered listeners ----------

const onPlayerAddListeners: PlayerAddCallback[] = [];
const onPlayerRemoveListeners: PlayerRemoveCallback[] = [];
const onPlayerChangeListeners: PlayerChangeCallback[] = [];
const onChatListeners: ChatCallback[] = [];

export function onPlayerAdd(cb: PlayerAddCallback): void {
  onPlayerAddListeners.push(cb);
}

export function onPlayerRemove(cb: PlayerRemoveCallback): void {
  onPlayerRemoveListeners.push(cb);
}

export function onPlayerChange(cb: PlayerChangeCallback): void {
  onPlayerChangeListeners.push(cb);
}

export function onChat(cb: ChatCallback): void {
  onChatListeners.push(cb);
}

// ---------- Helpers ----------

function snapshotFromSchema(player: Record<string, unknown>): PlayerSnapshot {
  return {
    id: player['id'] as string,
    name: player['name'] as string,
    x: player['x'] as number,
    y: player['y'] as number,
    z: player['z'] as number,
    rotation: player['rotation'] as number,
  };
}

// ---------- Connection ----------

export async function connect(playerName: string): Promise<Room> {
  client = new Client(SERVER_URL);
  room = await client.joinOrCreate('game', { name: playerName });

  room.state.players.onAdd((player: Record<string, unknown>, sessionId: string) => {
    const snap = snapshotFromSchema(player);
    console.log(`Player joined: ${snap.name} (${sessionId})`);
    for (const cb of onPlayerAddListeners) cb(sessionId, snap);

    // Listen for field changes on this player schema instance
    if (typeof (player as Record<string, unknown>)['onChange'] === 'function') {
      (player as { onChange: (cb: () => void) => void }).onChange(() => {
        const updated = snapshotFromSchema(player);
        for (const cb of onPlayerChangeListeners) cb(sessionId, updated);
      });
    }
  });

  room.state.players.onRemove((_player: Record<string, unknown>, sessionId: string) => {
    console.log(`Player left: ${sessionId}`);
    for (const cb of onPlayerRemoveListeners) cb(sessionId);
  });

  room.onMessage(MessageType.CHAT, (msg: ChatMessage) => {
    for (const cb of onChatListeners) cb(msg);
  });

  console.log(`Connected to room: ${room.roomId}`);
  return room;
}

export function getRoom(): Room | null {
  return room;
}

export function getSessionId(): string | null {
  return room?.sessionId ?? null;
}

export function sendInput(input: PlayerInput): void {
  room?.send(MessageType.PLAYER_INPUT, input);
}

export function sendChat(text: string): void {
  room?.send(MessageType.CHAT, { text });
}

export function disconnect(): void {
  room?.leave();
  room = null;
  client = null;
}
