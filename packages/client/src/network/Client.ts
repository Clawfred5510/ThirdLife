import { Client, Room } from 'colyseus.js';
import { DEFAULT_SERVER_PORT, MessageType, InputCommand, ChatMessage, ParcelData, Appearance, BuildingCategory } from '@gamestu/shared';

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

const PLAYER_ID_KEY = 'tl_player_id';
const AUTH_TOKEN_KEY = 'tl_auth_token';

function getOrCreatePlayerId(): string {
  if (typeof localStorage === 'undefined') return crypto.randomUUID();
  let id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    try { localStorage.setItem(PLAYER_ID_KEY, id); } catch { /* private mode, etc. — fall through */ }
  }
  return id;
}

function getStoredAuthToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try { return localStorage.getItem(AUTH_TOKEN_KEY); } catch { return null; }
}

function clearWalletCredentials(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(PLAYER_ID_KEY);
  } catch { /* ignore */ }
}

let client: Client | null = null;
let room: Room | null = null;
// "myId" — the persistent player identity (UUID in localStorage), used as
// stable identity across reconnects. Server returns it as PLAYER_STATE.self.
let mySessionId: string | null = null;

export interface PlayerSnapshot {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
  color: string;
  appearance?: Appearance;
  /**
   * Only set for AI agents.
   *   'auto'     = server autopilot is driving an in-game agent
   *   'agent'    = in-game agent with autopilot off (acts via API key)
   *   'external' = wallet-signed external REST agent (is_external=1).
   *                Renders with a green EXT badge.
   */
  bot_kind?: 'auto' | 'agent' | 'external';
  /**
   * AI agents only: workplace building category. Selects the droid GLB
   * (droidFood / droidMaterials / droidElectric / droidLux); undefined → the
   * hatless droid. Mirrors the server PlayerData.bot_category (must match name).
   */
  bot_category?: BuildingCategory;
  /**
   * Phase 4: player's current rank (null if they've never burned luxury).
   * Drives the nameplate color in the 3D world.
   */
  rank?: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | null;
  /**
   * Movement-redo (2026-05-31): the last input-command seq the server has
   * processed for this player. Only meaningful for the local player, who uses
   * it to reconcile (drop acked commands, replay the rest from x/z). Others = 0.
   */
  seq?: number;
}

export type PlayerAddCallback = (sessionId: string, player: PlayerSnapshot) => void;
export type PlayerRemoveCallback = (sessionId: string) => void;
export type PlayerChangeCallback = (sessionId: string, player: PlayerSnapshot) => void;
export type ChatCallback = (message: ChatMessage) => void;
export type CreditsUpdateCallback = (credits: number) => void;
export type JobUpdateCallback = (update: { jobType: string; objective: string; timeRemaining: number; progress: string }) => void;
export type JobCompleteCallback = (result: { jobType: string; reward: number }) => void;
export type TutorialCallback = (message: string) => void;
export type ParcelStateCallback = (parcels: ParcelData[]) => void;
export type ParcelUpdateCallback = (update: Partial<ParcelData> & { owner_name?: string; error?: string }) => void;
export type RankUpEvent = {
  player_id: string;
  from: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | null;
  to: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
  lifetime: number;
};
export type RankUpCallback = (e: RankUpEvent) => void;

const onPlayerAddListeners: PlayerAddCallback[] = [];
const onPlayerRemoveListeners: PlayerRemoveCallback[] = [];
const onPlayerChangeListeners: PlayerChangeCallback[] = [];
const onChatListeners: ChatCallback[] = [];
const onCreditsUpdateListeners: CreditsUpdateCallback[] = [];
const onJobUpdateListeners: JobUpdateCallback[] = [];
const onJobCompleteListeners: JobCompleteCallback[] = [];
const onTutorialListeners: TutorialCallback[] = [];
const onParcelStateListeners: ParcelStateCallback[] = [];
const onParcelUpdateListeners: ParcelUpdateCallback[] = [];
const onRankUpListeners: RankUpCallback[] = [];

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
export function onRankUp(cb: RankUpCallback): () => void {
  onRankUpListeners.push(cb);
  return () => {
    const i = onRankUpListeners.indexOf(cb);
    if (i !== -1) onRankUpListeners.splice(i, 1);
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
  const playerId = getOrCreatePlayerId();
  const authToken = getStoredAuthToken();
  client = new Client(SERVER_URL);
  try {
    room = await client.joinOrCreate('game', { name: playerName, playerId, authToken: authToken ?? undefined });
  } catch (err) {
    // Wallet auth is MANDATORY — there is no guest play (owner decision
    // 2026-05-31). The server rejects a missing/expired token with 4001
    // (auth_token_invalid) or 4003 (wallet_required). Drop the dead
    // credentials, signal the UI to re-prompt the wallet connect, and
    // rethrow — we do NOT silently rejoin as a guest anymore.
    const msg = (err as Error)?.message ?? '';
    if (/auth_token_invalid|wallet_required|4001|4003/.test(msg)) {
      clearWalletCredentials();
      window.dispatchEvent(new CustomEvent('wallet-auth-expired'));
    }
    throw err;
  }
  mySessionId = playerId;
  knownPlayers.clear();

  // Bind every message handler. Pulled into a helper so the post-reconnect
  // path (attachReconnectHandler → rewireRoomListeners) can re-bind the
  // same set without drift.
  rewireRoomListeners(room);

  // Auto-reconnect on transient WebSocket drops. Without this, a flaky
  // network silently strands the user: their local prediction keeps
  // running, but they stop receiving PLAYER_STATE — every other player
  // appears frozen on their last known position. The server's
  // allowReconnection(client, 60) window holds their session, parcels,
  // and credits intact for 60s so a quick reconnect is invisible. We
  // try up to 5 times with exponential backoff (0.5s, 1s, 2s, 4s, 8s).
  attachReconnectHandler(room);

  console.log(`Connected to room: ${room.roomId} as ${room.sessionId}`);
  return room;
}

function attachReconnectHandler(currentRoom: Room): void {
  currentRoom.onLeave(async (code) => {
    // Code 1000 = clean close (user logged out, navigated away). Don't retry.
    // Code 4001/4002/4003 = server-side rejection (auth bad / wallet takeover
    // / impersonation). Don't retry — let the existing error path handle it.
    if (code === 1000 || (code >= 4001 && code <= 4003)) {
      console.log(`[reconnect] room.onLeave code=${code} — not retrying`);
      return;
    }
    const token = currentRoom.reconnectionToken;
    if (!token || !client) {
      console.warn('[reconnect] no reconnection token; cannot retry');
      return;
    }
    const delays = [500, 1000, 2000, 4000, 8000];
    for (let i = 0; i < delays.length; i++) {
      await new Promise((r) => setTimeout(r, delays[i]));
      try {
        const newRoom = await client.reconnect(token);
        room = newRoom;
        // Re-attach every onMessage handler the original room had — they
        // were bound to the old room instance and don't carry over.
        rewireRoomListeners(newRoom);
        attachReconnectHandler(newRoom);
        console.log(`[reconnect] reattached on attempt ${i + 1}`);
        window.dispatchEvent(new CustomEvent('tl-reconnected'));
        return;
      } catch (err) {
        console.warn(`[reconnect] attempt ${i + 1} failed:`, (err as Error)?.message ?? err);
      }
    }
    // Out of attempts. Surface to the UI so it can show a "disconnected"
    // banner instead of silently leaving the player in a dead session.
    console.error('[reconnect] giving up after 5 attempts');
    window.dispatchEvent(new CustomEvent('tl-disconnected'));
  });
}

/**
 * Re-bind every onMessage handler to a freshly-reconnected room. The
 * handlers themselves are pure functions that read module-scope listener
 * arrays, so the bindings are stable across reconnects.
 */
function rewireRoomListeners(r: Room): void {
  r.onMessage(MessageType.PLAYER_STATE, (msg: { self?: string; players: PlayerSnapshot[] }) => {
    if (msg.self) mySessionId = msg.self;
    const seen = new Set<string>();
    for (const p of msg.players) {
      seen.add(p.id);
      applyPlayer(p, true);
    }
    for (const id of Array.from(knownPlayers.keys())) {
      if (!seen.has(id)) {
        knownPlayers.delete(id);
        for (const cb of onPlayerRemoveListeners) cb(id);
      }
    }
  });
  r.onMessage(MessageType.PLAYER_JOIN, (msg: PlayerSnapshot) => applyPlayer(msg, true));
  r.onMessage(MessageType.PLAYER_UPDATE, (msg: PlayerSnapshot) => applyPlayer(msg, true));
  r.onMessage(MessageType.PLAYER_LEAVE, (msg: { id: string }) => {
    if (knownPlayers.delete(msg.id)) {
      for (const cb of onPlayerRemoveListeners) cb(msg.id);
    }
  });
  r.onMessage(MessageType.CHAT, (msg: ChatMessage) => { for (const cb of onChatListeners) cb(msg); });
  r.onMessage(MessageType.CREDITS_UPDATE, (msg: { credits: number }) => {
    for (const cb of onCreditsUpdateListeners) cb(msg.credits);
  });
  r.onMessage(MessageType.JOB_UPDATE, (msg: { jobType: string; objective: string; timeRemaining: number; progress: string }) => {
    for (const cb of onJobUpdateListeners) cb(msg);
  });
  r.onMessage(MessageType.JOB_COMPLETE, (msg: { jobType: string; reward: number }) => {
    for (const cb of onJobCompleteListeners) cb(msg);
  });
  r.onMessage(MessageType.TUTORIAL, (msg: { message: string }) => {
    for (const cb of onTutorialListeners) cb(msg.message);
  });
  r.onMessage(MessageType.PARCEL_STATE, (msg: { parcels: ParcelData[] }) => {
    for (const cb of onParcelStateListeners) cb(msg.parcels);
  });
  r.onMessage(MessageType.PARCEL_UPDATE, (msg: Partial<ParcelData> & { owner_name?: string; error?: string }) => {
    for (const cb of onParcelUpdateListeners) cb(msg);
  });
  r.onMessage(MessageType.RESOURCE_UPDATE, (msg: unknown) => {
    window.dispatchEvent(new CustomEvent('resource-update', { detail: msg }));
  });
  r.onMessage(MessageType.WORK_RESULT, (msg: unknown) => {
    window.dispatchEvent(new CustomEvent('work-result', { detail: msg }));
  });
  r.onMessage(MessageType.RANK_UP, (msg: RankUpEvent) => {
    if (msg.player_id !== mySessionId) return;
    for (const cb of onRankUpListeners) cb(msg);
  });
  r.onMessage(MessageType.ITEM_UPDATE, (msg: unknown) => {
    window.dispatchEvent(new CustomEvent('item-update', { detail: msg }));
  });
}

export function getRoom(): Room | null {
  return room;
}

export function getSessionId(): string | null {
  return mySessionId;
}

export function sendInput(cmd: InputCommand): void {
  room?.send(MessageType.PLAYER_INPUT, cmd);
}

export function sendChat(text: string): void {
  room?.send(MessageType.CHAT, { text });
}

export function sendPlayerColor(color: string): void {
  room?.send(MessageType.PLAYER_COLOR, { color });
}

export function sendUpdateAppearance(partial: Partial<Appearance>): void {
  room?.send(MessageType.UPDATE_APPEARANCE, partial);
}

export function getLocalPlayer(): PlayerSnapshot | null {
  if (!mySessionId) return null;
  return knownPlayers.get(mySessionId) ?? null;
}

export function sendFastTravel(stopIndex: number): void {
  room?.send(MessageType.FAST_TRAVEL, { stopIndex });
}

export function sendRespawn(): void {
  room?.send(MessageType.RESPAWN, {});
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

export function sendClaimParcel(parcelId: number, buildingType: string): void {
  room?.send(MessageType.CLAIM_PARCEL, { parcelId, building_type: buildingType });
}

export function sendUpdateBusiness(parcelId: number, data: { name?: string; type?: string; color?: string; height?: number }): void {
  room?.send(MessageType.UPDATE_BUSINESS, { parcelId, ...data });
}

export function sendDemolish(parcelId: number): void {
  room?.send(MessageType.DEMOLISH_BUILDING, { parcelId });
}

export function sendBuildStructure(parcelId: number, buildingType: string): void {
  room?.send(MessageType.BUILD_STRUCTURE, { parcelId, buildingType });
}

export function sendWork(): void {
  room?.send(MessageType.WORK, {});
}

export function requestEvents(): void {
  room?.send(MessageType.EVENTS, {});
}

export function requestLeaderboard(): void {
  room?.send(MessageType.LEADERBOARD, {});
}

export function disconnect(): void {
  room?.leave();
  room = null;
  client = null;
  mySessionId = null;
  knownPlayers.clear();
}
