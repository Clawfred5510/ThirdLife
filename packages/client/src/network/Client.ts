import { Client, Room } from 'colyseus.js';
import { DEFAULT_SERVER_PORT, MessageType, PlayerInput, ChatMessage, ParcelData } from '@gamestu/shared';

// Resolution order: window override (injected pre-script) → Vite env var → same-host fallback
function resolveServerUrl(): string {
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __GAME_SERVER_URL__?: string };
    if (w.__GAME_SERVER_URL__) return w.__GAME_SERVER_URL__;
  }
  const viteUrl = (import.meta as unknown as { env?: { VITE_SERVER_URL?: string } }).env?.VITE_SERVER_URL;
  if (viteUrl) return viteUrl;
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}`;
  }
  return `ws://localhost:${DEFAULT_SERVER_PORT}`;
}

const SERVER_URL = resolveServerUrl();

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
  color: string;
}

export type PlayerAddCallback = (sessionId: string, player: PlayerSnapshot) => void;
export type PlayerRemoveCallback = (sessionId: string) => void;
export type PlayerChangeCallback = (sessionId: string, player: PlayerSnapshot) => void;
export type ChatCallback = (message: ChatMessage) => void;
export type CreditsUpdateCallback = (credits: number) => void;
export type PropertyUpdateCallback = (update: { propertyId: number; ownerId: string; ownerName: string }) => void;
export type JobUpdateCallback = (update: { jobType: string; objective: string; timeRemaining: number; progress: string }) => void;
export type JobCompleteCallback = (result: { jobType: string; reward: number }) => void;
export type TutorialCallback = (message: string) => void;
export type ParcelStateCallback = (parcels: ParcelData[]) => void;
export type ParcelUpdateCallback = (update: Partial<ParcelData> & { owner_name?: string; error?: string }) => void;

// ---------- Registered listeners ----------

const onPlayerAddListeners: PlayerAddCallback[] = [];
const onPlayerRemoveListeners: PlayerRemoveCallback[] = [];
const onPlayerChangeListeners: PlayerChangeCallback[] = [];
const onChatListeners: ChatCallback[] = [];
const onCreditsUpdateListeners: CreditsUpdateCallback[] = [];
const onPropertyUpdateListeners: PropertyUpdateCallback[] = [];
const onJobUpdateListeners: JobUpdateCallback[] = [];
const onJobCompleteListeners: JobCompleteCallback[] = [];
const onTutorialListeners: TutorialCallback[] = [];
const onParcelStateListeners: ParcelStateCallback[] = [];
const onParcelUpdateListeners: ParcelUpdateCallback[] = [];

/** Subscribe and return an unsubscribe function to avoid listener leaks. */
export function onPlayerAdd(cb: PlayerAddCallback): () => void {
  onPlayerAddListeners.push(cb);
  return () => {
    const idx = onPlayerAddListeners.indexOf(cb);
    if (idx !== -1) onPlayerAddListeners.splice(idx, 1);
  };
}

export function onPlayerRemove(cb: PlayerRemoveCallback): () => void {
  onPlayerRemoveListeners.push(cb);
  return () => {
    const idx = onPlayerRemoveListeners.indexOf(cb);
    if (idx !== -1) onPlayerRemoveListeners.splice(idx, 1);
  };
}

export function onPlayerChange(cb: PlayerChangeCallback): () => void {
  onPlayerChangeListeners.push(cb);
  return () => {
    const idx = onPlayerChangeListeners.indexOf(cb);
    if (idx !== -1) onPlayerChangeListeners.splice(idx, 1);
  };
}

export function onChat(cb: ChatCallback): () => void {
  onChatListeners.push(cb);
  return () => {
    const idx = onChatListeners.indexOf(cb);
    if (idx !== -1) onChatListeners.splice(idx, 1);
  };
}

export function onCreditsUpdate(cb: CreditsUpdateCallback): () => void {
  onCreditsUpdateListeners.push(cb);
  return () => {
    const idx = onCreditsUpdateListeners.indexOf(cb);
    if (idx !== -1) onCreditsUpdateListeners.splice(idx, 1);
  };
}

export function onPropertyUpdate(cb: PropertyUpdateCallback): () => void {
  onPropertyUpdateListeners.push(cb);
  return () => {
    const idx = onPropertyUpdateListeners.indexOf(cb);
    if (idx !== -1) onPropertyUpdateListeners.splice(idx, 1);
  };
}

export function onJobUpdate(cb: JobUpdateCallback): () => void {
  onJobUpdateListeners.push(cb);
  return () => {
    const idx = onJobUpdateListeners.indexOf(cb);
    if (idx !== -1) onJobUpdateListeners.splice(idx, 1);
  };
}

export function onJobComplete(cb: JobCompleteCallback): () => void {
  onJobCompleteListeners.push(cb);
  return () => {
    const idx = onJobCompleteListeners.indexOf(cb);
    if (idx !== -1) onJobCompleteListeners.splice(idx, 1);
  };
}

export function onTutorial(cb: TutorialCallback): () => void {
  onTutorialListeners.push(cb);
  return () => {
    const idx = onTutorialListeners.indexOf(cb);
    if (idx !== -1) onTutorialListeners.splice(idx, 1);
  };
}

export function onParcelState(cb: ParcelStateCallback): () => void {
  onParcelStateListeners.push(cb);
  return () => {
    const idx = onParcelStateListeners.indexOf(cb);
    if (idx !== -1) onParcelStateListeners.splice(idx, 1);
  };
}

export function onParcelUpdate(cb: ParcelUpdateCallback): () => void {
  onParcelUpdateListeners.push(cb);
  return () => {
    const idx = onParcelUpdateListeners.indexOf(cb);
    if (idx !== -1) onParcelUpdateListeners.splice(idx, 1);
  };
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
    color: (player['color'] as string) ?? '#3366cc',
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
    (player as any).onChange(() => {
      const updated = snapshotFromSchema(player);
      for (const cb of onPlayerChangeListeners) cb(sessionId, updated);
    });
  });

  room.state.players.onRemove((_player: Record<string, unknown>, sessionId: string) => {
    console.log(`Player left: ${sessionId}`);
    for (const cb of onPlayerRemoveListeners) cb(sessionId);
  });

  room.onMessage(MessageType.CHAT, (msg: ChatMessage) => {
    for (const cb of onChatListeners) cb(msg);
  });

  room.onMessage(MessageType.CREDITS_UPDATE, (msg: { credits: number }) => {
    for (const cb of onCreditsUpdateListeners) cb(msg.credits);
  });

  room.onMessage(MessageType.PROPERTY_UPDATE, (msg: { propertyId: number; ownerId: string; ownerName: string }) => {
    for (const cb of onPropertyUpdateListeners) cb(msg);
  });

  room.onMessage(MessageType.JOB_UPDATE, (msg: { jobType: string; objective: string; timeRemaining: number; progress: string }) => {
    for (const cb of onJobUpdateListeners) cb(msg);
  });

  room.onMessage(MessageType.JOB_COMPLETE, (msg: { jobType: string; reward: number }) => {
    for (const cb of onJobCompleteListeners) cb(msg);
  });

  room.onMessage(MessageType.TUTORIAL, (msg: { message: string }) => {
    for (const cb of onTutorialListeners) cb(msg.message);
  });

  room.onMessage(MessageType.PARCEL_STATE, (msg: { parcels: ParcelData[] }) => {
    for (const cb of onParcelStateListeners) cb(msg.parcels);
  });

  room.onMessage(MessageType.PARCEL_UPDATE, (msg: Partial<ParcelData> & { owner_name?: string; error?: string }) => {
    for (const cb of onParcelUpdateListeners) cb(msg);
  });

  // Parcels are synced via PARCEL_STATE (snapshot on join) and PARCEL_UPDATE
  // (incremental) messages above. They do NOT live in the Colyseus state
  // schema because syncing 2,500 entries broke the reflection decoder.

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

export function sendBuyProperty(propertyId: number): void {
  room?.send(MessageType.BUY_PROPERTY, { propertyId });
}

export function sendPlayerColor(color: string): void {
  room?.send(MessageType.PLAYER_COLOR, { color });
}

export function sendFastTravel(stopIndex: number): void {
  room?.send(MessageType.FAST_TRAVEL, { stopIndex });
}

export function sendJobStart(jobType: string): void {
  room?.send(MessageType.JOB_START, { jobType });
}

export function sendJobBoard(): void {
  room?.send(MessageType.JOB_BOARD, {});
}

export function getPlayerName(): string | null {
  // The player name is stored as a join option; retrieve from room state if available
  const sid = room?.sessionId;
  if (!sid || !room) return null;
  const player = room.state.players?.get(sid) as Record<string, unknown> | undefined;
  return (player?.['name'] as string) ?? null;
}

export function sendClaimParcel(parcelId: number): void {
  room?.send(MessageType.CLAIM_PARCEL, { parcelId });
}

export function sendUpdateBusiness(parcelId: number, data: { name?: string; type?: string; color?: string; height?: number }): void {
  room?.send(MessageType.UPDATE_BUSINESS, { parcelId, ...data });
}

export function disconnect(): void {
  room?.leave();
  room = null;
  client = null;
}
