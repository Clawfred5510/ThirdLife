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
let mySessionId: string | null = null;

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

export function onPlayerAdd(cb: PlayerAddCallback): () => void {
  onPlayerAddListeners.push(cb);
  return () => {
    const i = onPlayerAddListeners.indexOf(cb);
    if (i !== -1) onPlayerAddListeners.splice(i, 1);
  };
}
export function onPlayerRemove(cb: PlayerRemoveCallback): () => void {
  onPlayerRemoveListeners.push(cb);
  return () => {
    const i = onPlayerRemoveListeners.indexOf(cb);
    if (i !== -1) onPlayerRemoveListeners.splice(i, 1);
  };
}
export function onPlayerChange(cb: PlayerChangeCallback): () => void {
  onPlayerChangeListeners.push(cb);
  return () => {
    const i = onPlayerChangeListeners.indexOf(cb);
    if (i !== -1) onPlayerChangeListeners.splice(i, 1);
  };
}
export function onChat(cb: ChatCallback): () => void {
  onChatListeners.push(cb);
  return () => {
    const i = onChatListeners.indexOf(cb);
    if (i !== -1) onChatListeners.splice(i, 1);
  };
}
export function onCreditsUpdate(cb: CreditsUpdateCallback): () => void {
  onCreditsUpdateListeners.push(cb);
  return () => {
    const i = onCreditsUpdateListeners.indexOf(cb);
    if (i !== -1) onCreditsUpdateListeners.splice(i, 1);
  };
}
export function onPropertyUpdate(cb: PropertyUpdateCallback): () => void {
  onPropertyUpdateListeners.push(cb);
  return () => {
    const i = onPropertyUpdateListeners.indexOf(cb);
    if (i !== -1) onPropertyUpdateListeners.splice(i, 1);
  };
}
export function onJobUpdate(cb: JobUpdateCallback): () => void {
  onJobUpdateListeners.push(cb);
  return () => {
    const i = onJobUpdateListeners.indexOf(cb);
    if (i !== -1) onJobUpdateListeners.splice(i, 1);
  };
}
export function onJobComplete(cb: JobCompleteCallback): () => void {
  onJobCompleteListeners.push(cb);
  return () => {
    const i = onJobCompleteListeners.indexOf(cb);
    if (i !== -1) onJobCompleteListeners.splice(i, 1);
  };
}
export function onTutorial(cb: TutorialCallback): () => void {
  onTutorialListeners.push(cb);
  return () => {
    const i = onTutorialListeners.indexOf(cb);
    if (i !== -1) onTutorialListeners.splice(i, 1);
  };
}
export function onParcelState(cb: ParcelStateCallback): () => void {
  onParcelStateListeners.push(cb);
  return () => {
    const i = onParcelStateListeners.indexOf(cb);
    if (i !== -1) onParcelStateListeners.splice(i, 1);
  };
}
export function onParcelUpdate(cb: ParcelUpdateCallback): () => void {
  onParcelUpdateListeners.push(cb);
  return () => {
    const i = onParcelUpdateListeners.indexOf(cb);
    if (i !== -1) onParcelUpdateListeners.splice(i, 1);
  };
}

// Local cache of every known player snapshot (keyed by sessionId)
const knownPlayers = new Map<string, PlayerSnapshot>();
let myLastName: string | null = null;

function applyPlayer(snap: PlayerSnapshot, emitEventsForSelf: boolean) {
  const existing = knownPlayers.get(snap.id);
  knownPlayers.set(snap.id, snap);
  if (!existing) {
    if (!emitEventsForSelf && snap.id === mySessionId) return;
    for (const cb of onPlayerAddListeners) cb(snap.id, snap);
    if (snap.id === mySessionId) myLastName = snap.name;
  } else {
    if (!emitEventsForSelf && snap.id === mySessionId) {
      // still update local cache for self, no event
      return;
    }
    for (const cb of onPlayerChangeListeners) cb(snap.id, snap);
  }
}

export async function connect(playerName: string): Promise<Room> {
  client = new Client(SERVER_URL);
  room = await client.joinOrCreate('game', { name: playerName });
  mySessionId = room.sessionId;
  knownPlayers.clear();

  // Bulk player snapshot (sent on join, and periodic broadcasts)
  room.onMessage(MessageType.PLAYER_STATE, (msg: { self?: string; players: PlayerSnapshot[] }) => {
    if (msg.self) mySessionId = msg.self;
    const seen = new Set<string>();
    for (const p of msg.players) {
      seen.add(p.id);
      applyPlayer(p, /*emitEventsForSelf*/ true);
    }
    // Remove stale players not in latest snapshot
    for (const id of Array.from(knownPlayers.keys())) {
      if (!seen.has(id)) {
        knownPlayers.delete(id);
        for (const cb of onPlayerRemoveListeners) cb(id);
      }
    }
  });

  room.onMessage(MessageType.PLAYER_JOIN, (msg: PlayerSnapshot) => {
    applyPlayer(msg, true);
  });

  room.onMessage(MessageType.PLAYER_UPDATE, (msg: PlayerSnapshot) => {
    applyPlayer(msg, true);
  });

  room.onMessage(MessageType.PLAYER_LEAVE, (msg: { id: string }) => {
    if (knownPlayers.delete(msg.id)) {
      for (const cb of onPlayerRemoveListeners) cb(msg.id);
    }
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

  console.log(`Connected to room: ${room.roomId} as ${room.sessionId}`);
  return room;
}

export function getRoom(): Room | null {
  return room;
}

export function getSessionId(): string | null {
  return mySessionId;
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
  if (mySessionId) {
    const me = knownPlayers.get(mySessionId);
    if (me?.name) return me.name;
  }
  return myLastName;
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
  mySessionId = null;
  knownPlayers.clear();
}
