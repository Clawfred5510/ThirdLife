import { Room, Client } from 'colyseus';
import { GameState, PlayerData } from '../state/GameState';
import {
  TICK_RATE,
  PLAYER_SPEED,
  MessageType,
  PlayerInput,
  BUS_STOPS,
  SPAWN_POINT,
  features,
  Appearance,
  DEFAULT_APPEARANCE,
  BUILDINGS,
  BuildingType,
  BuildingCategory,
  INCOME_TICK_MS,
  ResourceType,
  FOOD_PER_AGENT_PER_TICK,
  ENERGY_PER_PRODUCING_BUILDING_PER_TICK,
  TIER_MULTIPLIER,
  LUXURY_PASSIVE_PER_TICK_BY_TIER,
  LAND_COST_AMETA as LAND_COST,
  STARVATION_GRACE_TICKS,
  CRAFT_RESOURCES_PER_ITEM,
  LuxuryItemKind,
  LUXURY_ITEMS,
  ITEM_FOR_BUILDING,
  TIER_INDEX,
  TIER_NAMES,
  type Tier,
  RANK_BURN_THRESHOLD,
  PROPERTY_FEE_BPS,
  BPS_DENOMINATOR,
  WORK_WAGE_AMETA_PER_TICK,
  MAX_OFFLINE_TICKS,
  consumesEnergy,
  emitsPassiveLuxury,
  parcelDoorPos,
  simulateMovement,
  isInputCommand,
  InputCommand,
  MAX_COMMAND_DT,
} from '@gamestu/shared';
import {
  getOrCreatePlayer,
  savePlayerPosition,
  getPlayerCredits as getPlayerCreditsFromDb,
  updatePlayerCredits,
  seedParcels,
  claimAndBuild,
  claimAndBuildWithVouchers,
  pickActiveVoucher,
  updateBusiness as updateBusinessInDb,
  getAllParcels,
  savePlayerAppearance,
  getPlayerResources,
  updatePlayerResources,
  setBuildingType,
  getPlayerParcels,
  getOwnedBuiltParcels,
  addEvent,
  getEvents,
  getAuthSessionPlayerId,
  getRawDb,
  getAllAgents,
  setAgentStarvation,
  getPlayerItems,
  addPlayerItems,
  burnLuxuryItems,
  getLastSettledTick,
  setLastSettledTick,
  bumpAgentLifetimeStats,
  bumpLifetimeLuxury,
  getLifetimeLuxuryBurned,
} from '../db';
import { advanceWorldTick, recordGdp } from '../world';
import { runAutopilotPass } from '../autopilot';
import { rankFor } from '../ranks';
import { economy, WORLD_TREASURY_ID } from '../economy';
import { onAgentChanged } from '../events/agentEvents';
import { onWalletChanged } from '../events/walletEvents';
// Sub-unit properties module retired 2026-05-20. Imports removed.
import { resolveDecreesTick } from '../governance';
import { getWorldTick } from '../world';
import { startJob, getActiveJob, cancelJob, checkObjective, tickWaitProgress, checkTimeExpired, getRemainingTime, getJobBoard, getActiveJobPlayerIds } from '../systems/jobs';
import { startTutorialIfNeeded, cancelTutorial } from '../systems/tutorial';

const PLAYER_BROADCAST_INTERVAL_MS = 100; // 10 Hz

export class GameRoom extends Room<GameState> {
  maxClients = 50;

  /** Server-side player map (NOT in Colyseus schema — see state/GameState.ts). */
  private players = new Map<string, PlayerData>();

  /**
   * Map of Colyseus sessionId → persistent player ID. Persistent ID is sent
   * by the client via `joinOrCreate` options (stored in localStorage) and is
   * what we use for all DB-bound ownership lookups (parcels, credits,
   * resources, appearance). This makes claims survive reconnects — without
   * it, a fresh sessionId on every connect locks parcels under dead IDs.
   */
  private pidBySession = new Map<string, string>();

  /**
   * Sessions whose disconnect was triggered by a wallet-takeover from a
   * newer session on the same persistentId. Their onLeave must SKIP the
   * PLAYER_LEAVE broadcast — otherwise other clients see the wallet's
   * avatar briefly removed before the 10Hz PLAYER_STATE re-adds it,
   * appearing as a flicker on every wallet reconnect.
   */
  private supersededSessions = new Set<string>();

  /**
   * Per-session token buckets for incoming Colyseus messages. Keys are
   * `sessionId:messageType`. Without this, a malicious client could
   * flood CHAT / APPEARANCE / claim messages, each of which fans out to
   * a broadcast or DB write — that's a trivial bandwidth and CPU DoS
   * for the whole room. PLAYER_INPUT is deliberately NOT rate-limited:
   * the server tick already caps how often inputs are consumed (20Hz),
   * and the client legitimately bursts inputs at the tick boundary.
   */
  private rateLimitBuckets = new Map<string, { tokens: number; lastRefill: number }>();

  /**
   * Token-bucket rate check. Returns true if the request is allowed,
   * false if it should be dropped. `capacity` is the burst size,
   * `refillPerSec` is the steady-state rate.
   */
  private checkRate(client: Client, type: string, capacity: number, refillPerSec: number): boolean {
    const key = `${client.sessionId}:${type}`;
    const now = Date.now();
    let b = this.rateLimitBuckets.get(key);
    if (!b) {
      b = { tokens: capacity, lastRefill: now };
      this.rateLimitBuckets.set(key, b);
    } else {
      const elapsed = (now - b.lastRefill) / 1000;
      if (elapsed > 0) {
        b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
        b.lastRefill = now;
      }
    }
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /**
   * Last input-command seq the server has PROCESSED for each session. Echoed
   * back to that client in PLAYER_STATE (snapshotPlayer.seq) so it can drop
   * acknowledged commands and replay the rest from the authoritative position
   * — server reconciliation. Movement is applied once per command in the
   * PLAYER_INPUT handler (NOT integrated over wall-clock time in the tick), so
   * the server moves the avatar by EXACTLY the commands the client sent and
   * stops the instant the client stops sending them. That structurally
   * removes the post-release "ice slide" the time-elapsed model produced.
   */
  private lastSeq = new Map<string, number>();

  /** Wall-clock ms of the last processed input command per player.id. Bounds
   *  the movement displacement budget so a client that floods commands can't
   *  speed-hack past real elapsed time (see the PLAYER_INPUT handler). */
  private lastCmdAt = new Map<string, number>();

  private pid(sessionId: string): string {
    return this.pidBySession.get(sessionId) ?? sessionId;
  }

  /** Accumulated time (ms) since last revenue tick. */
  private lastRevenueTick = 0;

  /** Accumulated time (ms) since last player-state broadcast. */
  private lastBroadcastTick = 0;

  /**
   * AI agents shown to clients as virtual players. Keyed by agent id.
   * Loaded from DB on boot, refreshed every autopilot tick and whenever
   * the REST agent-api fires an event via agentEvents. Positions are
   * updated by the autopilot pass and broadcast as PLAYER_UPDATE.
   */
  private agentPlayers = new Map<string, PlayerData>();

  /** Unsubscribe handle for the agent-events bus (set in onCreate, called in onDispose). */
  private offAgentChanged: (() => void) | null = null;

  /** Unsubscribe handle for the wallet-events bus. */
  private offWalletChanged: (() => void) | null = null;

  /**
   * Test-mode godmode wallets — keyed by wallet/player id. Toggled via
   * the `/godmode on|off` chat command (gated on TEST_BALANCE). At the
   * top of each per-player tick settlement, every resource for these
   * wallets is floored to 1,000,000 so production runs without ever
   * starving for energy and the player can shop the marketplace freely.
   */
  private godmodeWallets = new Set<string>();

  /**
   * Per-wallet last tick at which we emitted a `building_unpowered`
   * event. Used to throttle the notification — we don't want one event
   * per /skip iteration; once every 6 ticks (~1 in-game hour) is plenty.
   */
  private lastUnpoweredEventTick = new Map<string, number>();

  onCreate() {
    this.setState(new GameState());
    this.setSimulationInterval((deltaTime) => this.update(deltaTime), 1000 / TICK_RATE);

    // Keep the room alive even with zero connected humans. Agents need
    // to be "online" continuously and the autopilot tick lives in this
    // room's update loop. Without this, the room would dispose when the
    // last human leaves and the autopilot would stop until someone else
    // joined.
    this.autoDispose = false;

    // ---- Seed parcels into DB ----
    seedParcels();
    const allParcels = getAllParcels();
    console.log(`[GameRoom] ${allParcels.length} parcels in DB`);

    // ---- Load AI agents as virtual players ----
    this.refreshAgents(true);
    if (this.agentPlayers.size > 0) {
      console.log(`[GameRoom] ${this.agentPlayers.size} agents loaded into world`);
    }

    // Subscribe to agent-events so new/removed/toggled agents show up
    // immediately in the world (no 60s autopilot-tick wait).
    this.offAgentChanged = onAgentChanged(() => {
      this.refreshAgents(false);
    });

    // Subscribe to wallet-events so REST-side debits/credits (agent
    // purchase, marketplace fills routed via the API, etc.) refresh the
    // connected client's wallet UI without waiting for the next tick.
    this.offWalletChanged = onWalletChanged((walletId) => {
      this.pushCreditsForWallet(walletId);
    });

    // Sub-unit backfill removed 2026-05-20 with Phase C retirement.

    this.onMessage(MessageType.PLAYER_INPUT, (client: Client, msg: InputCommand) => {
      const player = this.players.get(client.sessionId);
      if (!player) return;

      // Rate-limit even movement input. The movement redo applies one
      // simulateMovement() per command (no per-tick integration), so without
      // a cap a modified client could FLOOD thousands of commands/sec and
      // speed-hack/teleport server-side. Capacity 150, refill 150/s comfortably
      // covers a 60fps client (which sends ~1/frame) plus burst, and drops a
      // degenerate flood. (network-code.md: rate-limit per client.)
      if (!this.checkRate(client, 'input', 150, 150)) return;

      // Only the sequenced InputCommand shape is accepted now (the pre-redo
      // boolean-state client is no longer deployed). lastSeq is keyed by the
      // PERSISTENT player id (player.id) — the same id snapshotPlayer() echoes
      // back as `seq` — NOT client.sessionId (players are keyed by sessionId
      // but player.id is the persistent wallet/guest id). Keying both sides by
      // player.id is what makes the ack resolve so the client prunes its buffer.
      if (!isInputCommand(msg)) return;
      const cmd = msg;
      if (
        typeof cmd.forward !== 'boolean' || typeof cmd.backward !== 'boolean' ||
        typeof cmd.left !== 'boolean' || typeof cmd.right !== 'boolean'
      ) return;
      if (cmd.sprint !== undefined && typeof cmd.sprint !== 'boolean') return;
      // Bounds-check numerics: a NaN/Infinity seq/dt/yaw from a buggy or
      // malicious client must never corrupt position or the seq ack.
      if (!Number.isFinite(cmd.seq) || !Number.isFinite(cmd.dt) || !Number.isFinite(cmd.yaw)) return;
      // Reject duplicates / out-of-order (WebSocket is ordered, but guard).
      if (cmd.seq <= (this.lastSeq.get(player.id) ?? 0)) return;

      // Wall-clock displacement budget: clamp the command's effective dt to the
      // REAL time elapsed since this player's last command (plus a small jitter
      // allowance). simulateMovement already caps a single command to
      // MAX_COMMAND_DT, but nothing else bounds commands-per-second — this
      // restores the wall-clock anchor the old time-elapsed model provided, so
      // total displacement can't exceed real time no matter how many commands
      // are sent. First command from a player has no prior timestamp → allow
      // up to MAX_COMMAND_DT.
      const now = Date.now();
      const prevAt = this.lastCmdAt.get(player.id);
      const realElapsed = prevAt === undefined ? MAX_COMMAND_DT : (now - prevAt) / 1000;
      const budgetedDt = Math.min(cmd.dt, realElapsed + 0.02); // +20ms jitter slack
      this.lastCmdAt.set(player.id, now);

      player.rotation = cmd.yaw;
      const next = simulateMovement({ x: player.x, z: player.z }, { ...cmd, dt: budgetedDt });
      player.x = next.x;
      player.z = next.z;
      this.lastSeq.set(player.id, cmd.seq);
    });

    this.onMessage(MessageType.CHAT, (client: Client, message: { text: string }) => {
      if (!this.checkRate(client, 'chat', 5, 1)) return; // 5 burst, 1/sec sustained
      if (typeof message.text !== 'string') return;
      const text = message.text.trim().slice(0, 200);
      if (text.length === 0) return;

      const player = this.players.get(client.sessionId);
      const senderName = player?.name ?? 'Unknown';

      // Test-build chat commands. Gated on TEST_BALANCE so prod never
      // exposes them — TEST_BALANCE is only set on the Railway test
      // server (per CLAUDE.md), the same flag that grants 10M $AMETA
      // on every login.
      if (text.startsWith('/') && process.env.TEST_BALANCE) {
        const handled = this.handleTestCommand(client, text);
        if (handled) return;
      }

      this.broadcast(MessageType.CHAT, {
        senderId: this.pid(client.sessionId),
        senderName,
        text,
      });
    });

    this.onMessage(MessageType.PLAYER_COLOR, (client: Client, data: { color: string }) => {
      if (!this.checkRate(client, 'color', 3, 0.5)) return;
      const player = this.players.get(client.sessionId);
      if (!player) return;
      if (typeof data.color !== 'string') return;
      player.color = data.color;
      player.appearance.shirt_color = data.color;
      savePlayerAppearance(this.pid(client.sessionId), JSON.stringify(player.appearance));
      this.broadcast(MessageType.PLAYER_UPDATE, this.snapshotPlayer(player));
    });

    this.onMessage(MessageType.UPDATE_APPEARANCE, (client: Client, data: Partial<Appearance>) => {
      if (!this.checkRate(client, 'appearance', 5, 1)) return;
      const player = this.players.get(client.sessionId);
      if (!player) return;

      const HEX = /^#[0-9a-fA-F]{6}$/;
      const HAT = new Set(['none', 'cap', 'tophat', 'beanie']);
      const SHIRT = new Set(['basic', 'stripe', 'vest']);
      const PANTS = new Set(['basic', 'shorts']);
      const SHOES = new Set(['basic', 'boots']);
      const ACC = new Set(['none', 'chain', 'sunglasses', 'bowtie']);

      const next: Appearance = { ...player.appearance };
      if (typeof data.body_color === 'string' && HEX.test(data.body_color)) next.body_color = data.body_color;
      if (typeof data.hat_style === 'string' && HAT.has(data.hat_style)) next.hat_style = data.hat_style as Appearance['hat_style'];
      if (typeof data.hat_color === 'string' && HEX.test(data.hat_color)) next.hat_color = data.hat_color;
      if (typeof data.shirt_style === 'string' && SHIRT.has(data.shirt_style)) next.shirt_style = data.shirt_style as Appearance['shirt_style'];
      if (typeof data.shirt_color === 'string' && HEX.test(data.shirt_color)) next.shirt_color = data.shirt_color;
      if (typeof data.pants_style === 'string' && PANTS.has(data.pants_style)) next.pants_style = data.pants_style as Appearance['pants_style'];
      if (typeof data.pants_color === 'string' && HEX.test(data.pants_color)) next.pants_color = data.pants_color;
      if (typeof data.shoes_style === 'string' && SHOES.has(data.shoes_style)) next.shoes_style = data.shoes_style as Appearance['shoes_style'];
      if (typeof data.shoes_color === 'string' && HEX.test(data.shoes_color)) next.shoes_color = data.shoes_color;
      if (typeof data.accessory_style === 'string' && ACC.has(data.accessory_style)) next.accessory_style = data.accessory_style as Appearance['accessory_style'];
      if (typeof data.accessory_color === 'string' && HEX.test(data.accessory_color)) next.accessory_color = data.accessory_color;

      player.appearance = next;
      player.color = next.shirt_color; // legacy `color` tracks shirt
      savePlayerAppearance(this.pid(client.sessionId), JSON.stringify(next));
      this.broadcast(MessageType.PLAYER_UPDATE, this.snapshotPlayer(player));
    });

    this.onMessage(MessageType.CLAIM_PARCEL, (
      client: Client,
      data: { parcelId: number; building_type: string },
    ) => {
      if (!this.checkRate(client, 'claim', 3, 1)) return;
      const player = this.players.get(client.sessionId);
      if (!player) return;
      if (typeof data.parcelId !== 'number' || data.parcelId < 0 || data.parcelId > 2499) return;
      if (typeof data.building_type !== 'string') {
        client.send(MessageType.CLAIM_PARCEL, { error: 'building_type is required' });
        return;
      }
      const spec = BUILDINGS[data.building_type as BuildingType];
      if (!spec) {
        client.send(MessageType.CLAIM_PARCEL, {
          error: 'Unknown building type', valid: Object.keys(BUILDINGS),
        });
        return;
      }

      const ownerId = this.pid(client.sessionId);

      // Voucher pre-check. The wipe-and-voucherize migration may have
      // issued LAND / BUILDING vouchers to this wallet — if so, they're
      // consumed atomically with the claim and waive the corresponding
      // costs. A BUILDING voucher also bypasses the minRank gate (it
      // represents a building the player already had before the wipe).
      const landVoucher = pickActiveVoucher(ownerId, 'land');
      const buildingVoucher = pickActiveVoucher(ownerId, 'building', { buildingType: data.building_type });

      // Phase 4 rank gate — only enforced when no BUILDING voucher waives it.
      if (!buildingVoucher && TIER_INDEX[rankFor(ownerId)] < TIER_INDEX[spec.minRank]) {
        client.send(MessageType.CLAIM_PARCEL, {
          error: 'rank_required',
          required_rank: spec.minRank,
          current_rank: rankFor(ownerId),
        });
        return;
      }
      const result = claimAndBuildWithVouchers(
        ownerId, data.parcelId, data.building_type, spec.cost, spec.label, spec.materialCost,
        { land: landVoucher?.id, building: buildingVoucher?.id },
      );
      if (!result.ok) {
        client.send(MessageType.CLAIM_PARCEL, {
          error: result.reason,
          detail: result.reason === 'insufficient_balance'
            ? { required_ameta: spec.cost + LAND_COST }
            : result.reason === 'insufficient_materials'
              ? { required_materials: spec.materialCost }
              : undefined,
        });
        return;
      }
      player.credits = getPlayerCreditsFromDb(ownerId);
      client.send(MessageType.CREDITS_UPDATE, { credits: player.credits });
      this.broadcast(MessageType.PARCEL_UPDATE, {
        id: data.parcelId,
        owner_id: ownerId,
        owner_name: player.name,
        business_name: spec.label,
        business_type: data.building_type,
      });
      const usedLand = result.usedLandVoucher ?? false;
      const usedBuild = result.usedBuildingVoucher ?? false;
      addEvent('claim_and_build', ownerId, {
        parcel: data.parcelId, building: data.building_type,
        cost_ameta: (usedLand ? 0 : LAND_COST) + (usedBuild ? 0 : spec.cost),
        cost_materials: usedBuild ? 0 : spec.materialCost,
        voucher_land: usedLand, voucher_building: usedBuild,
      }, 'major');
      const tags = [
        usedLand ? '🎫 land voucher' : null,
        usedBuild ? '🎫 building voucher' : null,
      ].filter(Boolean).join(' + ');
      console.log(
        `${player.name} claimed parcel #${data.parcelId} + built ${spec.label}` +
        (tags ? ` (${tags})` : ` (-${spec.cost + LAND_COST} $AMETA, -${spec.materialCost} materials)`),
      );
    });

    this.onMessage(MessageType.UPDATE_BUSINESS, (client: Client, data: { parcelId: number; name?: string; type?: string; color?: string; height?: number }) => {
      if (!this.checkRate(client, 'update_business', 3, 1)) return;
      const player = this.players.get(client.sessionId);
      if (!player) return;
      if (typeof data.parcelId !== 'number' || data.parcelId < 0 || data.parcelId > 2499) return;

      const ownerId = this.pid(client.sessionId);
      const success = updateBusinessInDb(data.parcelId, ownerId, data);
      if (success) {
        this.broadcast(MessageType.PARCEL_UPDATE, {
          id: data.parcelId,
          owner_id: ownerId,
          business_name: data.name,
          business_type: data.type,
          color: data.color,
          height: data.height,
        });
      } else {
        client.send(MessageType.UPDATE_BUSINESS, { error: 'Update failed (not owner or parcel not claimed)' });
      }
    });

    this.onMessage(MessageType.DEMOLISH_BUILDING, (client: Client, data: { parcelId: number }) => {
      if (!this.checkRate(client, 'demolish', 3, 1)) return;
      const player = this.players.get(client.sessionId);
      if (!player) return;
      if (typeof data.parcelId !== 'number' || data.parcelId < 0 || data.parcelId > 2499) return;

      const ownerId = this.pid(client.sessionId);
      const allParcels = getAllParcels();
      const parcel = allParcels.find((p) => p.id === data.parcelId);
      if (!parcel) {
        client.send(MessageType.DEMOLISH_BUILDING, { error: 'parcel_not_found' });
        return;
      }
      if (parcel.owner_id !== ownerId) {
        client.send(MessageType.DEMOLISH_BUILDING, { error: 'not_owner' });
        return;
      }
      const buildingType = (parcel as { building_type?: string }).building_type as BuildingType | undefined;
      if (!buildingType) {
        client.send(MessageType.DEMOLISH_BUILDING, { error: 'nothing_to_demolish' });
        return;
      }

      // Refund 50% of the building's original $AMETA and materials cost
      // (land cost stays sunk; the parcel remains owned + rebuild-able).
      const spec = BUILDINGS[buildingType];
      const refundAmeta = spec ? Math.floor(spec.cost / 2) : 0;
      const refundMaterials = spec ? Math.floor(spec.materialCost / 2) : 0;
      if (refundAmeta > 0) {
        const newCredits = player.credits + refundAmeta;
        updatePlayerCredits(ownerId, newCredits);
        player.credits = newCredits;
        client.send(MessageType.CREDITS_UPDATE, { credits: player.credits });
      }
      if (refundMaterials > 0) {
        const r = getPlayerResources(ownerId);
        r.materials += refundMaterials;
        updatePlayerResources(ownerId, r);
        client.send(MessageType.RESOURCE_UPDATE, r);
      }

      // Clear the building from the parcel + any sub-units associated
      // with it (Phase C apartments/offices).
      setBuildingType(data.parcelId, '');
      updateBusinessInDb(data.parcelId, ownerId, { type: '', name: '' });
      try {
        const db = getRawDb();
        db.prepare('DELETE FROM properties WHERE parcel_id = ?').run(data.parcelId);
      } catch (err) {
        console.warn('[demolish] sub-unit cleanup failed:', err);
      }

      this.broadcast(MessageType.PARCEL_UPDATE, {
        id: data.parcelId,
        owner_id: ownerId,
        business_name: '',
        business_type: '',
        building_type: '',
      });

      addEvent('demolish', ownerId, {
        parcel: data.parcelId, building: buildingType,
        refund_ameta: refundAmeta, refund_materials: refundMaterials,
      }, 'major');
      console.log(`${player.name} demolished ${buildingType} on parcel #${data.parcelId} (refund ${refundAmeta} $AMETA + ${refundMaterials} materials)`);
    });

    this.onMessage(MessageType.FAST_TRAVEL, (client: Client, data: { stopIndex: number }) => {
      if (!this.checkRate(client, 'fast_travel', 3, 0.5)) return;
      const player = this.players.get(client.sessionId);
      if (!player) return;
      const stop = BUS_STOPS[data.stopIndex];
      if (!stop) return;
      player.x = stop.x;
      player.z = stop.z;
      this.broadcast(MessageType.PLAYER_UPDATE, this.snapshotPlayer(player));
    });

    // Phone "Spawn" app — teleport the player back to the world origin.
    // No payload; spawn coords come from shared constants so server and
    // client always agree. Position is persisted so a reconnect lands
    // at spawn too.
    this.onMessage(MessageType.RESPAWN, (client: Client) => {
      if (!this.checkRate(client, 'respawn', 3, 0.5)) return;
      const player = this.players.get(client.sessionId);
      if (!player) return;
      player.x = SPAWN_POINT.x;
      player.y = SPAWN_POINT.y;
      player.z = SPAWN_POINT.z;
      player.rotation = 0;
      this.lastSeq.delete(this.pid(client.sessionId));
      this.lastCmdAt.delete(this.pid(client.sessionId));
      savePlayerPosition(this.pid(client.sessionId), player.x, player.y, player.z);
      this.broadcast(MessageType.PLAYER_UPDATE, this.snapshotPlayer(player));
    });

    // ---- BUILD_STRUCTURE: place a typed building on an owned parcel ----
    this.onMessage(MessageType.BUILD_STRUCTURE, (client: Client, data: { parcelId: number; buildingType: string }) => {
      if (!this.checkRate(client, 'build', 3, 1)) return;
      const player = this.players.get(client.sessionId);
      if (!player) return;
      if (typeof data.parcelId !== 'number' || typeof data.buildingType !== 'string') return;
      const spec = BUILDINGS[data.buildingType as BuildingType];
      if (!spec) { client.send(MessageType.BUILD_STRUCTURE, { error: 'Unknown building type' }); return; }
      // Phase 4: cost = spec.cost + 1% property fee.
      const propFee = Math.floor((spec.cost * PROPERTY_FEE_BPS) / BPS_DENOMINATOR);
      const grossCost = spec.cost + propFee;
      if (player.credits < grossCost) {
        client.send(MessageType.BUILD_STRUCTURE, { error: 'Insufficient credits', cost: grossCost });
        return;
      }

      const ownerId = this.pid(client.sessionId);
      // Phase 4: rank gate.
      if (TIER_INDEX[rankFor(ownerId)] < TIER_INDEX[spec.minRank]) {
        client.send(MessageType.BUILD_STRUCTURE, {
          error: 'rank_required',
          required_rank: spec.minRank,
          current_rank: rankFor(ownerId),
        });
        return;
      }
      const parcels = getPlayerParcels(ownerId);
      const parcel = parcels.find(p => p.id === data.parcelId);
      if (!parcel) { client.send(MessageType.BUILD_STRUCTURE, { error: 'You do not own this parcel' }); return; }

      // Phase 1: materials required for construction (Tier-II+ buildings).
      if (spec.materialCost > 0) {
        const r = getPlayerResources(ownerId);
        if (r.materials < spec.materialCost) {
          client.send(MessageType.BUILD_STRUCTURE, { error: 'Insufficient materials', required_materials: spec.materialCost });
          return;
        }
        r.materials -= spec.materialCost;
        updatePlayerResources(ownerId, r);
        client.send(MessageType.RESOURCE_UPDATE, r);
      }

      player.credits -= grossCost;
      updatePlayerCredits(ownerId, player.credits);
      // Treasury gets the property fee.
      if (propFee > 0) economy().credit(WORLD_TREASURY_ID, propFee, 'property_fee').catch(() => {});
      setBuildingType(data.parcelId, data.buildingType);
      updateBusinessInDb(data.parcelId, ownerId, { type: data.buildingType, name: spec.label });
      // Sub-unit generation removed 2026-05-20 with Phase C retirement.

      client.send(MessageType.CREDITS_UPDATE, { credits: player.credits });
      this.broadcast(MessageType.PARCEL_UPDATE, {
        id: data.parcelId,
        owner_id: ownerId,
        business_name: spec.label,
        business_type: data.buildingType,
      });
      addEvent('build', ownerId, { parcel: data.parcelId, building: data.buildingType, cost: spec.cost }, 'major');
      console.log(`${player.name} built ${spec.label} on parcel #${data.parcelId} (-${spec.cost} credits)`);
    });

    // ---- WORK: production is TICK-AUTHORITATIVE, no on-demand minting ----
    // Owned buildings produce resources ONLY during the server income tick
    // (the same path for players and bots — see update() / the economy
    // settlement, which writes via updatePlayerResources). The old on-demand
    // WORK handler added spec.amount per building per call with no cooldown or
    // rate limit, so a client could flood WORK to mint unlimited resources
    // (sellable for $AMETA on the order book). WORK no longer mints anything;
    // it just echoes the player's current resources so any legacy caller gets
    // a harmless state refresh instead of free resources.
    this.onMessage(MessageType.WORK, (client: Client) => {
      const player = this.players.get(client.sessionId);
      if (!player) return;
      const ownerId = this.pid(client.sessionId);
      const resources = getPlayerResources(ownerId);
      client.send(MessageType.WORK_RESULT, { produced: {}, creditsEarned: 0, resources });
      client.send(MessageType.RESOURCE_UPDATE, resources);
    });

    // (Legacy Colyseus TRADE + MARKET_PRICES handlers removed 2026-05-16.
    //  All resource trading goes through the REST order book — see
    //  POST /api/v1/market/order. Humans use their wallet session token,
    //  agents use their tl_sk_ API key; same endpoint, one ledger.)

    // ---- BURN_LUXURY: spec §6 — commit luxury items for rank points ----
    this.onMessage(MessageType.BURN_LUXURY, (client: Client, data: { item_kind: string; quantity: number }) => {
      const player = this.players.get(client.sessionId);
      if (!player) return;
      if (typeof data?.item_kind !== 'string') return;
      if (!Number.isInteger(data.quantity) || data.quantity <= 0) return;

      const spec = LUXURY_ITEMS[data.item_kind as LuxuryItemKind];
      if (!spec) { client.send(MessageType.BURN_LUXURY, { error: 'unknown_item' }); return; }
      const ownerId = this.pid(client.sessionId);
      const r = burnLuxuryItems(ownerId, data.item_kind, data.quantity, spec.burnValue);
      if (!r.ok) { client.send(MessageType.BURN_LUXURY, { error: r.reason ?? 'burn_failed' }); return; }

      client.send(MessageType.BURN_LUXURY, {
        ok: true,
        item_kind: data.item_kind,
        burned: data.quantity,
        rank_points_gained: r.gained,
        lifetime: r.lifetime,
      });
      client.send(MessageType.ITEM_UPDATE, getPlayerItems(ownerId));

      // Burn visual particle removed per owner direction 2026-05-20 —
      // the BURN_EFFECT broadcast was a stub for a column-of-light
      // particle that's now skipped (perf). The rank-up confetti is the
      // replacement spectacle, fired below when promotion happens.

      addEvent(
        'burn_luxury', ownerId,
        { item_kind: data.item_kind, quantity: data.quantity, rank_points_gained: r.gained, lifetime: r.lifetime },
        // Spec §6: global feed announcement when a single burn ≥ 1000 rank points.
        (r.gained ?? 0) >= 1000 ? 'major' : 'minor',
      );

      // UI Overhaul: rank-up celebration. burnLuxuryItems atomically
      // computes the new rank inside its transaction, so we can detect
      // the promotion by comparing rankBefore / rankAfter and emit a
      // dedicated RANK_UP broadcast for the centered confetti modal.
      if (r.rankBefore !== r.rankAfter && r.rankAfter) {
        this.broadcast(MessageType.RANK_UP, {
          player_id: ownerId,
          from: r.rankBefore,
          to: r.rankAfter,
          lifetime: r.lifetime,
        });
        addEvent('rank_up', ownerId, {
          from: r.rankBefore, to: r.rankAfter, lifetime: r.lifetime,
        }, 'major');
      }

      console.log(`${player.name} burned ${data.quantity}× ${spec.label} (+${r.gained} rank, lifetime ${r.lifetime})`);
    });

    // ---- EVENTS: return recent events ----
    this.onMessage(MessageType.EVENTS, (client: Client) => {
      client.send(MessageType.EVENTS, { events: getEvents(50) });
    });

    // ---- LEADERBOARD: return player rankings ----
    this.onMessage(MessageType.LEADERBOARD, (client: Client) => {
      const allPlayers = Array.from(this.players.values());
      const board = allPlayers.map(p => {
        const parcels = getPlayerParcels(p.id);
        return {
          id: p.id, name: p.name, credits: p.credits,
          parcels: parcels.length,
          buildings: parcels.filter(pp => (pp as any).building_type).length,
        };
      }).sort((a, b) => b.credits - a.credits);
      client.send(MessageType.LEADERBOARD, { leaderboard: board });
    });

    if (features.JOBS) {
      this.onMessage(MessageType.JOB_BOARD, (client: Client) => {
        client.send(MessageType.JOB_BOARD, { jobs: getJobBoard() });
      });

      this.onMessage(MessageType.JOB_START, (client: Client, data: { jobType: string }) => {
        const player = this.players.get(client.sessionId);
        if (!player) return;
        if (typeof data.jobType !== 'string') return;

        const job = startJob(client.sessionId, data.jobType);
        if (!job) {
          client.send(MessageType.JOB_START, { error: 'Cannot start job (cooldown or invalid type)' });
          return;
        }

        client.send(MessageType.JOB_START, {
          jobType: job.jobType,
          objectives: job.objectives.map((o) => ({
            type: o.type,
            x: o.x,
            z: o.z,
            radius: o.radius,
            duration: o.duration,
            completed: o.completed,
          })),
          timeLimit: job.timeLimit,
          currentObjective: job.currentObjective,
        });
      });
    }

    console.log(`GameRoom created: ${this.roomId}`);
  }

  onJoin(client: Client, options: { name?: string; playerId?: string; authToken?: string }) {
    // Persistent player identity. Wallet auth is MANDATORY — there is no guest
    // play (owner decision 2026-05-31). Every human client must present a valid
    // SIWE session token; the token's wallet address IS the playerId. This is
    // enforced SERVER-SIDE so a modified client can't bypass the front-end gate.
    //   1. Valid authToken → wallet address it was minted for is the playerId.
    //   2. authToken present but expired/invalid → REJECT (4001) so the client
    //      re-prompts the wallet connect.
    //   3. No token (guest UUID, raw wallet address, or nothing) → REJECT
    //      (4003 wallet_required). Bots/agents are server-side room state, not
    //      Colyseus clients, so this only gates human browsers.
    let persistentId: string;
    if (typeof options.authToken === 'string' && options.authToken.length > 0) {
      const tokenPid = getAuthSessionPlayerId(options.authToken);
      if (!tokenPid) {
        client.error(401, 'auth_token_invalid');
        client.leave(4001, 'auth_token_invalid');
        return;
      }
      persistentId = tokenPid;
    } else {
      client.error(403, 'wallet_required');
      client.leave(4003, 'wallet_required');
      return;
    }
    this.pidBySession.set(client.sessionId, persistentId);

    // One wallet, one live session. If the same persistentId is already
    // connected from a different session, drop the older one so the new
    // device takes over. Without this, two devices on the same wallet
    // each control their own server-side PlayerData but broadcast under
    // the SAME wallet id — knownPlayers on every client dedupes by id
    // and the avatars desync.
    for (const [otherSessionId, otherPid] of this.pidBySession) {
      if (otherSessionId === client.sessionId) continue;
      if (otherPid !== persistentId) continue;
      // Mark the doomed session as superseded so its imminent onLeave skips
      // the PLAYER_LEAVE broadcast — otherwise every other client briefly
      // removes the wallet's avatar (the new session's PLAYER_JOIN already
      // fired, but its id == the leaving session's id, so the LEAVE wins).
      this.supersededSessions.add(otherSessionId);
      const otherClient = this.clients.find((c) => c.sessionId === otherSessionId);
      if (otherClient) {
        try { otherClient.leave(4002, 'wallet_taken_over_elsewhere'); } catch { /* best effort */ }
      }
      // onLeave will fire and clean pidBySession + players for this session.
    }

    const displayName = options.name || `Player_${persistentId.slice(0, 4)}`;
    const row = getOrCreatePlayer(persistentId, displayName);

    // ── Phase 6: offline accrual ──────────────────────────────────────
    // Replay (capped) missed ticks of the passive income loop so a
    // returning player isn't punished for sleeping. Only the time-
    // independent flows accrue: luxury Housing/Civic passive luxury and
    // work-role wages on agents owned by this wallet. Production +
    // crafting + food + starvation are NOT replayed — they require
    // continuous resource/energy balancing that this player wasn't
    // around to manage. The current tick logic still applies to all of
    // those once they're connected. See `applyOfflineAccrual` below.
    const offlineRecap = this.applyOfflineAccrual(persistentId);

    let appearance: Appearance = { ...DEFAULT_APPEARANCE };
    if (row.appearance) {
      try {
        const parsed = JSON.parse(row.appearance);
        appearance = { ...DEFAULT_APPEARANCE, ...parsed };
      } catch (_) {
        // Corrupt JSON — fall back to defaults
      }
    }

    const refreshedCredits = getPlayerCreditsFromDb(persistentId);
    const player: PlayerData = {
      id: persistentId,
      name: row.name,
      x: row.x,
      y: row.y,
      z: row.z,
      rotation: 0,
      credits: refreshedCredits,
      color: appearance.shirt_color,
      appearance,
    };
    this.players.set(client.sessionId, player);

    // Tell the joining client about itself + all current players + all agents.
    client.send(MessageType.PLAYER_STATE, {
      self: persistentId,
      players: [
        ...Array.from(this.players.values()).map((p) => this.snapshotPlayer(p)),
        ...Array.from(this.agentPlayers.values()).map((p) => this.snapshotPlayer(p)),
      ],
    });

    // Tell everyone else about the new player
    this.broadcast(MessageType.PLAYER_JOIN, this.snapshotPlayer(player), { except: client });

    // Initial credits + resources UI sync
    client.send(MessageType.CREDITS_UPDATE, { credits: player.credits });
    client.send(MessageType.RESOURCE_UPDATE, getPlayerResources(persistentId));

    // Phase 6 offline-accrual recap. Only send if anything actually
    // happened — first-time logins or sub-tick reconnects get no popup.
    if (offlineRecap.missedTicks > 0 && (offlineRecap.luxury > 0 || offlineRecap.wages > 0)) {
      client.send(MessageType.OFFLINE_RECAP, offlineRecap);
    }

    // Parcel snapshot
    const snapshot = getAllParcels().map((p) => ({
      id: p.id,
      grid_x: p.grid_x,
      grid_y: p.grid_y,
      owner_id: p.owner_id ?? '',
      business_name: p.business_name ?? '',
      business_type: p.business_type ?? '',
      color: p.color,
      height: p.height,
    }));
    client.send(MessageType.PARCEL_STATE, { parcels: snapshot });

    if (features.TUTORIAL) {
      startTutorialIfNeeded(client.sessionId, client);
    }

    console.log(`${player.name} joined (sid=${client.sessionId}, pid=${persistentId}) — credits: ${player.credits}`);
  }

  async onLeave(client: Client, consented?: boolean): Promise<void> {
    const persistentId = this.pid(client.sessionId);
    const superseded = this.supersededSessions.delete(client.sessionId);

    // Drop the player's ack-seq immediately on disconnect (keyed by persistent
    // id). The player record stays in this.players so other clients keep seeing
    // them at their last position during the reconnect window. On reconnect the
    // client keeps its own seq counter and the server picks up acking from 0.
    this.lastSeq.delete(persistentId);
    this.lastCmdAt.delete(persistentId);

    // Non-consented leaves (network blip, browser sleep, mobile background)
    // get a 60s reconnection window. The session, player record, parcels,
    // and credits all stay intact; the client just rejoins with the same
    // sessionId and resumes. Without this, every flaky packet drop = full
    // PLAYER_LEAVE flood to every other client + position save + accrual
    // settle + the next reconnect creates a fresh PLAYER_JOIN (visible as
    // a flicker for everyone watching).
    if (!consented && !superseded) {
      try {
        await this.allowReconnection(client, 60);
        console.log(`[reconnect] sid=${client.sessionId} pid=${persistentId} reconnected within window`);
        return; // they came back; player record was never torn down
      } catch {
        // Timed out — fall through to full cleanup
      }
    }

    const player = this.players.get(client.sessionId);
    if (player) {
      savePlayerPosition(persistentId, player.x, player.y, player.z);
      // Phase 6: stamp the accrual baseline so the next login starts
      // counting from now, not from the last rank/burn write.
      this.settleOnLeave(persistentId);
      console.log(`${player.name} left (sid=${client.sessionId}, pid=${persistentId}, superseded=${superseded}) — position saved`);
    }
    this.players.delete(client.sessionId);
    this.lastSeq.delete(persistentId);
    this.pidBySession.delete(client.sessionId);
    // Drop the session's rate-limit buckets so the map doesn't leak.
    for (const key of Array.from(this.rateLimitBuckets.keys())) {
      if (key.startsWith(`${client.sessionId}:`)) this.rateLimitBuckets.delete(key);
    }
    cancelJob(client.sessionId);
    if (features.TUTORIAL) {
      cancelTutorial(client.sessionId);
    }
    // Skip the LEAVE broadcast when the disconnect was caused by a
    // wallet-takeover — the new session already broadcast PLAYER_JOIN
    // for the same persistentId. Sending LEAVE here would remove the
    // freshly-joined avatar from every other client until the next
    // 10Hz PLAYER_STATE re-adds it (visible as a flicker).
    if (!superseded) {
      this.broadcast(MessageType.PLAYER_LEAVE, { id: persistentId });
    }
  }

  /**
   * Advance each agent toward its assigned waypoint. Called every
   * server tick from update(). PLAYER_SPEED is shared with humans —
   * agents walk at the same pace so the world reads coherent. Once
   * within `ARRIVE_EPSILON` of the target, we snap and stop; the avatar
   * animation engine on the client switches from walk to idle when
   * velocity drops to zero.
   */
  private stepAgents(dt: number): void {
    const ARRIVE_EPSILON = 0.5;
    const step = PLAYER_SPEED * dt;
    this.agentPlayers.forEach((a) => {
      if (a.targetX === undefined || a.targetZ === undefined) return;
      const dx = a.targetX - a.x;
      const dz = a.targetZ - a.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= ARRIVE_EPSILON) {
        a.x = a.targetX;
        a.z = a.targetZ;
        return;
      }
      if (dist <= step) {
        a.x = a.targetX;
        a.z = a.targetZ;
      } else {
        a.x += (dx / dist) * step;
        a.z += (dz / dist) * step;
      }
      // Face the direction of motion so the walk animation looks right.
      a.rotation = Math.atan2(dx, dz);
    });
  }

  /**
   * Phase 6 offline accrual.
   *
   * Replays (capped) missed ticks of the time-independent passive
   * income for the connecting wallet: per-tick luxury Housing/Civic
   * emission + per-tick wages for work-role agents at luxury buildings.
   * Production, crafting, food, and starvation are intentionally NOT
   * replayed — those require energy/inventory balancing the player
   * wasn't present to manage. The current tick still applies once
   * they're connected.
   *
   * Returns a summary the join handler forwards to the client.
   */
  private applyOfflineAccrual(walletId: string): {
    missedTicks: number; luxury: number; wages: number;
  } {
    const currentTick = getWorldTick();
    const lastSettled = getLastSettledTick(walletId);
    // First settle ever (column default 0) — just stamp now, no accrual.
    if (lastSettled === 0) {
      setLastSettledTick(walletId, currentTick);
      return { missedTicks: 0, luxury: 0, wages: 0 };
    }
    const elapsed = Math.max(0, currentTick - lastSettled);
    const missedTicks = Math.min(elapsed, MAX_OFFLINE_TICKS);
    if (missedTicks === 0) return { missedTicks: 0, luxury: 0, wages: 0 };

    // Per-tick passive luxury emission across this wallet's housing/civic
    // buildings. Energy not required for these.
    let perTickLuxury = 0;
    for (const row of getOwnedBuiltParcels()) {
      if (row.owner_id !== walletId) continue;
      const bt = row.building_type as BuildingType;
      const spec = BUILDINGS[bt];
      if (!spec) continue;
      if (emitsPassiveLuxury(bt)) {
        const idx = Math.max(0, spec.tier - 1);
        perTickLuxury += LUXURY_PASSIVE_PER_TICK_BY_TIER[idx] ?? 0;
      }
    }

    // Per-tick wages = count of this wallet's active work-role agents
    // currently stationed at a luxury building.
    let wageAgentCount = 0;
    const wageAgentIds: string[] = [];
    const parcels = new Map<number, ReturnType<typeof getAllParcels>[number]>();
    for (const p of getAllParcels()) parcels.set(p.id, p);
    for (const a of getAllAgents()) {
      if (a.owner_wallet !== walletId) continue;
      if (a.dormant_at_tick != null) continue;
      if (a.autopilot_enabled !== 1) continue;
      if (a.is_external === 1) continue;
      if (a.role !== 'work') continue;
      if (a.workplace_parcel_id == null) continue;
      const wp = parcels.get(a.workplace_parcel_id);
      if (!wp) continue;
      const bt = (wp as { building_type?: string }).building_type as BuildingType | undefined;
      if (!bt) continue;
      const spec = BUILDINGS[bt];
      if (!spec) continue;
      if (spec.category === 'luxury-housing' || spec.category === 'luxury-civic') {
        wageAgentCount += 1;
        wageAgentIds.push(a.id);
      }
    }
    const perTickWage = wageAgentCount * WORK_WAGE_AMETA_PER_TICK;

    const luxuryDelta = perTickLuxury * missedTicks;
    const wageTotal = perTickWage * missedTicks;

    // Apply: luxury to the wallet's resource pool; wages divided equally
    // across the qualifying agents (per-agent balance, just like a live
    // tick).
    if (luxuryDelta > 0) {
      const r = getPlayerResources(walletId);
      r.luxury += luxuryDelta;
      updatePlayerResources(walletId, r);
      // UI Overhaul: offline-accrual luxury counts toward rank too.
      // Mirrors the live tick's bumpLifetimeLuxury call. The connecting
      // client will pick up the new rank/lifetime when it requests
      // /wallet/rank after join; we don't need a RANK_UP broadcast since
      // there's no confetti moment for accrual (the offline_accrual
      // notification already surfaces the gain).
      bumpLifetimeLuxury(walletId, luxuryDelta);
    }
    let wagePaid = 0;
    if (wageTotal > 0) {
      // Treasury-funded (owner direction 2026-05-31): pay the wallet from the
      // World Treasury, capped at what the treasury can afford. NOTE: the
      // previous code credited each AGENT id (not the owner wallet) — a latent
      // bug, since an agent id isn't a spendable player balance. Wages now go
      // to the agent OWNER (walletId), as a treasury→player transfer.
      const treasury = getPlayerCreditsFromDb(WORLD_TREASURY_ID);
      wagePaid = Math.min(wageTotal, treasury);
      if (wagePaid > 0) {
        updatePlayerCredits(WORLD_TREASURY_ID, treasury - wagePaid);
        const cur = getPlayerCreditsFromDb(walletId);
        updatePlayerCredits(walletId, cur + wagePaid);
      }
    }

    setLastSettledTick(walletId, currentTick);
    addEvent('offline_accrual', walletId, {
      missed_ticks: missedTicks, luxury: luxuryDelta, wages: wagePaid,
    }, 'minor');
    return { missedTicks, luxury: luxuryDelta, wages: wagePaid };
  }

  /** Mark the wallet as settled at the current tick on disconnect so
   *  the next join's accrual window starts from now, not from the last
   *  burn / rank update. */
  private settleOnLeave(walletId: string): void {
    setLastSettledTick(walletId, getWorldTick());
  }

  private snapshotPlayer(p: PlayerData) {
    return {
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      z: p.z,
      rotation: p.rotation,
      color: p.color,
      appearance: p.appearance,
      bot_kind: p.bot_kind,
      // Phase 4: nameplate color is driven by rank on the client. Agents
      // inherit their owner wallet's rank automatically (rankFor walks).
      rank: rankFor(p.id),
      // Last input-command seq processed for this session (0 for agents /
      // never-input players). The owning client uses it to reconcile:
      // drop acked commands, replay the rest from this authoritative position.
      seq: this.lastSeq.get(p.id) ?? 0,
    };
  }

  /**
   * Refresh the in-room agent set from the DB. New agents get a
   * PLAYER_JOIN broadcast so connected clients render them immediately.
   * Removed agents (currently never — we don't delete) get a PLAYER_LEAVE.
   *
   * Called once at boot (silent — no clients yet) and once per autopilot
   * tick so agents created mid-session show up within 60s.
   */
  private refreshAgents(initial: boolean): void {
    const fresh = getAllAgents();
    // Snapshot parcels once for O(1) workplace lookups during body placement.
    const parcelById = new Map(getAllParcels().map((p) => [p.id, p]));
    const seen = new Set<string>();
    for (const a of fresh) {
      seen.add(a.id);
      const existing = this.agentPlayers.get(a.id);
      if (existing) {
        // Owner may have toggled autopilot on/off via the REST endpoint;
        // propagate that to the broadcast so the AUTO/AGENT/EXT badge updates.
        const wanted: 'auto' | 'agent' | 'external' =
          a.is_external === 1 ? 'external'
          : a.autopilot_enabled === 1 ? 'auto'
          : 'agent';
        if (existing.bot_kind !== wanted) {
          existing.bot_kind = wanted;
          if (!initial) this.broadcast(MessageType.PLAYER_UPDATE, this.snapshotPlayer(existing));
        }
        continue;
      }
      const row = getOrCreatePlayer(a.id, a.name);
      let appearance: Appearance = { ...DEFAULT_APPEARANCE };
      const src = a.appearance ?? row.appearance;
      if (src) {
        try { appearance = { ...DEFAULT_APPEARANCE, ...JSON.parse(src) }; } catch { /* keep default */ }
      }

      // Canonical body placement — single source of truth for where an agent
      // stands: the parcel "door" (parcelDoorPos — centre, 12u south, shared
      // with autopilot.parcelDoor + REST agent spawn) of its workplace for
      // in-game agents, or of the owner's first parcel for external agents
      // (their on-plot representation). This corrects agents persisted with
      // the old stale formula (off by ~124u) the moment they load, and means
      // an agent is at its worksite immediately instead of waiting a full
      // income tick. Unemployed/parcel-less agents keep their spread row.
      let sx = row.x, sy = row.y, sz = row.z;
      const placeParcel = a.workplace_parcel_id !== null
        ? parcelById.get(a.workplace_parcel_id)
        : (a.is_external === 1 && a.owner_wallet ? getPlayerParcels(a.owner_wallet)[0] : undefined);
      if (placeParcel) {
        const door = parcelDoorPos(placeParcel.grid_x, placeParcel.grid_y);
        sx = door.x; sy = door.y; sz = door.z;
        // Persist the correction so the stored row stops drifting (backfill).
        if (Math.abs(sx - row.x) > 0.01 || Math.abs(sz - row.z) > 0.01) {
          savePlayerPosition(a.id, sx, sy, sz);
        }
      }

      const pd: PlayerData = {
        id: a.id,
        name: a.name,
        x: sx, y: sy, z: sz,
        rotation: 0,
        credits: row.credits,
        color: appearance.shirt_color,
        appearance,
        bot_kind:
          a.is_external === 1 ? 'external'
          : a.autopilot_enabled === 1 ? 'auto'
          : 'agent',
        // Already standing at its worksite (placement above), so the initial
        // target equals the position — no teleport, no walk on first load.
        targetX: sx, targetY: sy, targetZ: sz,
      };
      this.agentPlayers.set(a.id, pd);
      if (!initial) {
        this.broadcast(MessageType.PLAYER_JOIN, this.snapshotPlayer(pd));
      }
    }
    for (const id of Array.from(this.agentPlayers.keys())) {
      if (!seen.has(id)) {
        this.agentPlayers.delete(id);
        if (!initial) this.broadcast(MessageType.PLAYER_LEAVE, { id });
      }
    }
  }

  /**
   * Test-build chat command dispatcher.
   *
   * Returns true when the message was consumed by a command and
   * should NOT be re-broadcast as normal chat. Caller already
   * gated on TEST_BALANCE so this method assumes test mode.
   *
   * Supported commands:
   *   /skip [N]       — fast-forward N income ticks (default 1, max 1000).
   *                     Each iteration calls update(INCOME_TICK_MS) which
   *                     re-runs the full tick body (production, wages,
   *                     consumption, crafting, autopilot, etc).
   *   /tick           — alias for /skip 1.
   *   /help           — list available test commands.
   */
  private handleTestCommand(client: Client, text: string): boolean {
    const [cmd, ...rest] = text.slice(1).split(/\s+/);
    const lower = cmd.toLowerCase();
    const replyTo = (msg: string) => {
      client.send(MessageType.CHAT, {
        senderId: 'system',
        senderName: 'TEST',
        text: msg,
      });
    };

    if (lower === 'skip' || lower === 'tick') {
      const raw = rest[0];
      const parsed = raw == null ? 1 : Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        replyTo(`Usage: /skip <N>  (1..1000). Got "${raw}".`);
        return true;
      }
      const n = Math.min(1000, Math.floor(parsed));
      const start = Date.now();
      const startTick = getWorldTick();
      for (let i = 0; i < n; i++) {
        try {
          this.update(INCOME_TICK_MS);
        } catch (err) {
          console.error(`[/skip] tick ${i + 1}/${n} threw:`, err);
          replyTo(`Aborted at tick ${i + 1}/${n}: ${(err as Error).message}`);
          return true;
        }
      }
      const elapsed = Date.now() - start;
      const endTick = getWorldTick();
      replyTo(`Skipped ${n} tick${n === 1 ? '' : 's'} (world ${startTick} → ${endTick}) in ${elapsed}ms.`);
      return true;
    }

    if (lower === 'give') {
      const playerId = this.pid(client.sessionId);
      const firstArg = (rest[0] ?? '').toLowerCase();
      const isCreditMode =
        firstArg === 'credit' || firstArg === 'credits' || firstArg === 'ameta' || firstArg === '$ameta';

      if (isCreditMode) {
        const rawAmount = rest[1];
        const amount = rawAmount == null ? 10_000_000 : Number.parseInt(rawAmount, 10);
        if (!Number.isFinite(amount) || amount < 1) {
          replyTo(`Usage: /give credit [amount]  (default 10000000). Got "${rawAmount}".`);
          return true;
        }
        const cur = getPlayerCreditsFromDb(playerId);
        updatePlayerCredits(playerId, cur + amount);
        // notifyWalletChanged would also work, but we have the client
        // handle right here — send the CREDITS_UPDATE directly so the
        // Wallet UI updates within the same tick.
        client.send(MessageType.CREDITS_UPDATE, { credits: cur + amount });
        // Mirror it into the cached player object so subsequent
        // server-side reads (e.g. BUILD_STRUCTURE) see the new balance.
        const cached = this.players.get(client.sessionId);
        if (cached) cached.credits = cur + amount;
        replyTo(`Granted ${amount.toLocaleString()} $AMETA.`);
        return true;
      }

      const raw = rest[0];
      const amount = raw == null ? 100_000 : Number.parseInt(raw, 10);
      if (!Number.isFinite(amount) || amount < 1) {
        replyTo(`Usage: /give <amount>  (resources)  OR  /give credit [amount]  ($AMETA).`);
        return true;
      }
      const r = getPlayerResources(playerId);
      const next = {
        food: r.food + amount,
        materials: r.materials + amount,
        energy: r.energy + amount,
        luxury: r.luxury + amount,
      };
      updatePlayerResources(playerId, next);
      client.send(MessageType.RESOURCE_UPDATE, next);
      replyTo(`Granted ${amount.toLocaleString()} of each resource.`);
      return true;
    }

    if (lower === 'godmode' || lower === 'god') {
      const playerId = this.pid(client.sessionId);
      const arg = (rest[0] ?? '').toLowerCase();
      if (arg === 'off' || arg === 'false' || arg === '0') {
        this.godmodeWallets.delete(playerId);
        replyTo('Godmode OFF.');
      } else {
        this.godmodeWallets.add(playerId);
        replyTo(
          'Godmode ON — resources floor at 1,000,000 each tick. Type "/godmode off" to disable.',
        );
        // Apply the floor immediately so the user sees the result without
        // waiting for the next tick.
        const r = getPlayerResources(playerId);
        const FLOOR = 1_000_000;
        const next = {
          food: Math.max(r.food, FLOOR),
          materials: Math.max(r.materials, FLOOR),
          energy: Math.max(r.energy, FLOOR),
          luxury: Math.max(r.luxury, FLOOR),
        };
        updatePlayerResources(playerId, next);
        client.send(MessageType.RESOURCE_UPDATE, next);
      }
      return true;
    }

    if (lower === 'rank') {
      const playerId = this.pid(client.sessionId);
      const arg = (rest[0] ?? '').toLowerCase();
      if (!TIER_NAMES.includes(arg as Tier)) {
        replyTo(
          `Usage: /rank <bronze|silver|gold|platinum|diamond>. Got "${arg}".`,
        );
        return true;
      }
      const target = arg as Tier;
      const targetThreshold = RANK_BURN_THRESHOLD[target];
      const current = getLifetimeLuxuryBurned(playerId);
      const delta = Math.max(0, targetThreshold - current);
      if (delta === 0) {
        replyTo(
          `Already at or above ${target} (lifetime luxury used: ${current.toLocaleString()}).`,
        );
        return true;
      }
      const r = bumpLifetimeLuxury(playerId, delta);
      if (r.rankBefore !== r.rankAfter && r.rankAfter) {
        this.broadcast(MessageType.RANK_UP, {
          player_id: playerId,
          from: r.rankBefore,
          to: r.rankAfter,
          lifetime: r.lifetime,
        });
        addEvent('rank_up', playerId, {
          from: r.rankBefore, to: r.rankAfter, lifetime: r.lifetime,
        }, 'major');
      }
      replyTo(
        `Set rank to ${target} (lifetime ${r.lifetime.toLocaleString()}).`,
      );
      return true;
    }

    if (lower === 'help') {
      replyTo(
        'Test commands: /skip [N], /tick, /give [amount], /give credit [amount], /godmode [on|off], /rank <tier>, /help',
      );
      return true;
    }

    return false;
  }

  update(deltaTime: number) {
    const dt = deltaTime / 1000;

    // ---- Step agents toward their waypoints ----
    // Walks each agent toward (targetX, targetZ) at PLAYER_SPEED. When
    // within arrival epsilon they snap and stop (target == position).
    // Position diffs propagate to clients via the periodic PLAYER_STATE
    // broadcast below, which includes agents — the client lerps over
    // the 100ms broadcast interval, so the result is a smooth walk.
    this.stepAgents(dt);

    // Player movement is applied per-command in the PLAYER_INPUT handler
    // (authoritative client-prediction model), NOT integrated here over
    // wall-clock time. The tick only steps agents, broadcasts, and ticks
    // the economy.

    // ---- Broadcast player positions at fixed rate ----
    // Includes agents so the client's PLAYER_STATE handler (which removes
    // any player not in the snapshot) doesn't delete them every 100ms. The
    // agent positions are stepped by stepAgents() each tick.
    this.lastBroadcastTick += deltaTime;
    if (this.lastBroadcastTick >= PLAYER_BROADCAST_INTERVAL_MS && this.players.size > 0) {
      this.lastBroadcastTick = 0;
      this.broadcast(MessageType.PLAYER_STATE, {
        players: [
          ...Array.from(this.players.values()).map((p) => this.snapshotPlayer(p)),
          ...Array.from(this.agentPlayers.values()).map((p) => this.snapshotPlayer(p)),
        ],
      });
    }

    // ---- Tick economy ----
    // One pass over all owned-built parcels; compute per-owner production,
    // income capacity, and energy demand. Then settle each connected player:
    //   1. Add tick production (farm/mine/shop/factory) to resources
    //   2. Deduct 1 food per connected agent (consumption)
    //   3. For each income-paying building the owner has, try to burn 1
    //      energy to pay that income. If there isn't enough energy, the
    //      extra buildings pay nothing this tick (partial payout).
    // All applied via DB transactional helpers for crash-safety.
    this.lastRevenueTick += deltaTime;
    if (this.lastRevenueTick >= INCOME_TICK_MS) {
      this.lastRevenueTick = 0;
      // Snapshot the GDP from the just-completed tick + bump the
      // counter. recordGdp() calls anywhere in the codebase have been
      // accumulating into the running tick — this rolls them over.
      advanceWorldTick();

      // Phase B autopilot — every registered agent with autopilot
      // enabled acts according to its personality + strategy. Wrapped
      // in try/catch by runAutopilotPass per-agent. Returns the agents'
      // target waypoints — the per-frame stepAgents() walks them there
      // at PLAYER_SPEED, rather than teleporting.
      const moves = runAutopilotPass();
      // Pick up new agents that were registered since the last tick.
      this.refreshAgents(false);
      for (const m of moves) {
        const a = this.agentPlayers.get(m.agentId);
        if (!a) continue;
        a.targetX = m.x; a.targetY = m.y; a.targetZ = m.z;
      }

      // Phase C sub-unit income removed 2026-05-20 with the module retirement.

      // Phase E.3: resolve any decree whose voting window has elapsed.
      // Best-effort — never throws into the tick.
      resolveDecreesTick(getWorldTick()).catch((err) => {
        console.error('[governance] resolve failed:', err);
      });

      // ── Phase 1 production tick ──────────────────────────────────
      //
      // Per spec §2 / §7 / §9:
      //   • Every producing building (food/materials/energy) consumes
      //     exactly 1 energy/tick. If the owner can't supply that energy,
      //     the building produces 0 this tick (binary, not proportional).
      //   • Output = TIER_MULTIPLIER[tier-1] × (1 + agentsAtThisParcel).
      //     The "1" is the base passive output; agents amplify it.
      //   • Only agents with role='produce', autopilot enabled, not
      //     external, and not dormant count toward the agent term.
      //   • Luxury Housing + Civic emit LUXURY_PASSIVE_PER_TICK_BY_TIER
      //     for free (no energy consumed).
      //   • $AMETA wages for role='work' agents and rank production
      //     bonuses are wired in Phase 4.
      //
      // Step A: snapshot agents once + index by owner + by workplace parcel.
      // Dormant agents skip everything — they don't produce, don't eat,
      // don't accumulate starvation. Only an owner-initiated `revive`
      // (which costs 100 food) brings them back.
      // Snapshot parcels once so the agent-indexing pass can look up the
      // workplace's building category in O(1). Reused below in the
      // owner-bucket loop.
      const parcelById = new Map<number, ReturnType<typeof getAllParcels>[number]>();
      for (const p of getAllParcels()) parcelById.set(p.id, p);

      const allAgents = getAllAgents();
      const activeAgentsByOwner = new Map<string, typeof allAgents>();
      // UI Overhaul: track agent IDs (not just counts) per parcel so we
      // can attribute lifetime stats per agent inside the production
      // + crafting loops.
      const produceAgentsByParcel = new Map<number, string[]>();
      const craftAgentsByParcel = new Map<number, string[]>();
      // UI Overhaul (2026-05-20): work-role agents at luxury buildings
      // pay WORK_WAGE_AMETA_PER_TICK to the AGENT'S OWNER WALLET directly
      // (the /allocate fund-and-reclaim dance is retired). For cross-
      // player Stage-3 hires, the parcel owner pays the agent owner;
      // self-employment is server-funded (NPC employer abstraction).
      // Tracked as a list of {agentId, agentOwner, parcelOwner} so the
      // settlement pass can route per-pair.
      const wagePairs: Array<{ agentId: string; agentOwner: string; parcelOwner: string }> = [];

      for (const a of allAgents) {
        if (a.dormant_at_tick != null) continue;
        if (a.owner_wallet) {
          const list = activeAgentsByOwner.get(a.owner_wallet) ?? [];
          list.push(a);
          activeAgentsByOwner.set(a.owner_wallet, list);
        }
        if (
          a.autopilot_enabled !== 1 ||
          a.is_external === 1 ||
          a.workplace_parcel_id == null
        ) continue;

        // Resolve workplace category — drives the role/output mapping.
        // Owner clarification 2026-05-20:
        //   • Agent at production (food/materials/energy):
        //       role='work' or 'produce' → +1 produce-agent for the
        //         parcel's resource output ("work at a production place
        //         makes that desired resource")
        //       role='craft' → +1 craft-agent (already existing)
        //   • Agent at luxury (housing/civic):
        //       role='work' → wage payout each tick
        //       other roles → no effect (produce/craft are inert at
        //         luxury buildings; the building itself emits passive
        //         luxury already)
        const parcel = parcelById.get(a.workplace_parcel_id);
        if (!parcel) continue;
        const bt = (parcel as { building_type?: string }).building_type as BuildingType | undefined;
        if (!bt) continue;
        const spec = BUILDINGS[bt];
        if (!spec) continue;

        const isProduction = spec.category === 'food' || spec.category === 'materials' || spec.category === 'energy';
        const isLuxury = spec.category === 'luxury-housing' || spec.category === 'luxury-civic';

        if (isProduction) {
          if (a.role === 'craft') {
            const list = craftAgentsByParcel.get(a.workplace_parcel_id) ?? [];
            list.push(a.id);
            craftAgentsByParcel.set(a.workplace_parcel_id, list);
          } else {
            // role='produce' or 'work' both produce the resource at
            // production buildings.
            const list = produceAgentsByParcel.get(a.workplace_parcel_id) ?? [];
            list.push(a.id);
            produceAgentsByParcel.set(a.workplace_parcel_id, list);
          }
        } else if (isLuxury && a.role === 'work' && a.owner_wallet) {
          const parcelOwner = parcel.owner_id ?? '';
          if (parcelOwner) {
            wagePairs.push({
              agentId: a.id,
              agentOwner: a.owner_wallet,
              parcelOwner,
            });
          }
        }
      }

      // Step B: bucket owners' producing buildings + passive luxury.
      interface Producer {
        parcelId: number;
        category: BuildingCategory;
        tier: number;
        produceAgentIds: string[];
        craftAgentIds: string[];
        itemKind: LuxuryItemKind | null;
      }
      interface OwnerBucket {
        producers: Producer[];                 // need 1 energy each
        passiveLuxury: number;                 // sum of housing/civic
      }
      const byOwner = new Map<string, OwnerBucket>();
      const getBucket = (id: string): OwnerBucket => {
        let b = byOwner.get(id);
        if (!b) {
          b = {
            producers: [],
            passiveLuxury: 0,
          };
          byOwner.set(id, b);
        }
        return b;
      };

      for (const row of getOwnedBuiltParcels()) {
        const bt = row.building_type as BuildingType;
        const spec = BUILDINGS[bt];
        if (!spec) continue;
        const b = getBucket(row.owner_id);

        if (consumesEnergy(bt)) {
          b.producers.push({
            parcelId: row.id,
            category: spec.category,
            tier: spec.tier,
            produceAgentIds: produceAgentsByParcel.get(row.id) ?? [],
            craftAgentIds: craftAgentsByParcel.get(row.id) ?? [],
            itemKind: ITEM_FOR_BUILDING[bt] ?? null,
          });
        } else if (emitsPassiveLuxury(bt)) {
          const idx = Math.max(0, spec.tier - 1);
          b.passiveLuxury += LUXURY_PASSIVE_PER_TICK_BY_TIER[idx] ?? 0;
        }
      }

      // Pre-compute wages-by-owner so the per-player tick-income event
      // (emitted below) can include the wage amount this wallet will
      // earn from work-role agents at luxury buildings. We assume the
      // wage settlement loop pays out — for same-owner pairs it always
      // does; for cross-player pairs the parcel owner might not be able
      // to afford it (silent fail), but that's a tiny minority case and
      // we don't pre-validate here to avoid double-walking the data.
      const expectedWagesByOwner = new Map<string, number>();
      for (const pair of wagePairs) {
        expectedWagesByOwner.set(
          pair.agentOwner,
          (expectedWagesByOwner.get(pair.agentOwner) ?? 0) + WORK_WAGE_AMETA_PER_TICK,
        );
      }

      // Step C: settle each connected player.
      this.players.forEach((player, sessionId) => {
        const ownerId = player.id;
        const bucket = byOwner.get(ownerId);
        const resources = getPlayerResources(ownerId);

        // Test mode: godmode wallets get a 1M resource floor BEFORE the
        // tick spends anything, so power plants are always powered, food
        // never runs out, and the marketplace is unrestricted.
        if (this.godmodeWallets.has(ownerId)) {
          const FLOOR = 1_000_000;
          if (resources.food < FLOOR) resources.food = FLOOR;
          if (resources.materials < FLOOR) resources.materials = FLOOR;
          if (resources.energy < FLOOR) resources.energy = FLOOR;
          if (resources.luxury < FLOOR) resources.luxury = FLOOR;
        }

        // Snapshot resources BEFORE any production / consumption /
        // crafting so the tick-income notification can show the net
        // delta for each resource at the end of the settlement.
        const beforeResources = {
          food: resources.food,
          materials: resources.materials,
          energy: resources.energy,
          luxury: resources.luxury,
        };

        const itemDeltas = new Map<LuxuryItemKind, number>();
        // Per-agent stats accumulated this tick — flushed to DB + sent
        // as craft events at the end of the player's settlement.
        interface CraftMint {
          agentId: string;
          parcelId: number;
          itemKind: LuxuryItemKind;
          quantity: number;
        }
        const tickCraftMints: CraftMint[] = [];

        if (bucket) {
          // Owner direction 2026-05-20: energy buildings are self-powered.
          // Split producers into two cohorts:
          //   selfPowered → energy category, always runs, output is added
          //                 to the stockpile BEFORE grid-powered producers
          //                 draw from it. This breaks the bootstrap deadlock.
          //   gridPowered → food/materials, gated by current energy pool.
          const allSorted = [...bucket.producers].sort((a, b2) => a.parcelId - b2.parcelId);
          const selfPowered = allSorted.filter((p) => p.category === 'energy');
          const gridPowered = allSorted.filter((p) => p.category !== 'energy');

          // Run self-powered (energy) producers first so their output
          // can power food/materials in the same tick.
          for (const p of selfPowered) {
            const mult = TIER_MULTIPLIER[p.tier - 1] ?? 0;
            const produceAgentCount = p.produceAgentIds.length;
            const produceOut = mult * (1 + produceAgentCount);
            resources.energy += produceOut;
            for (const aid of p.produceAgentIds) {
              bumpAgentLifetimeStats(aid, { resources: { energy: mult } });
            }
            // Energy buildings still support crafting (e.g. batteries
            // crafted at a Coal Plant). Same atomic mint logic as below.
            if (p.craftAgentIds.length > 0 && p.itemKind) {
              for (const aid of p.craftAgentIds) {
                const itemsThisAgent = mult;
                const cost = CRAFT_RESOURCES_PER_ITEM * itemsThisAgent;
                if (resources.energy < cost) continue;
                resources.energy -= cost;
                itemDeltas.set(
                  p.itemKind,
                  (itemDeltas.get(p.itemKind) ?? 0) + itemsThisAgent,
                );
                bumpAgentLifetimeStats(aid, { items: { [p.itemKind]: itemsThisAgent } });
                tickCraftMints.push({
                  agentId: aid,
                  parcelId: p.parcelId,
                  itemKind: p.itemKind,
                  quantity: itemsThisAgent,
                });
              }
            }
          }

          // Grid-powered producers: gated by current (post-energy-output) pool.
          const poweredCount = Math.min(
            gridPowered.length,
            Math.floor(resources.energy / ENERGY_PER_PRODUCING_BUILDING_PER_TICK),
          );
          resources.energy -= poweredCount * ENERGY_PER_PRODUCING_BUILDING_PER_TICK;

          // Notify the player when grid-powered buildings sit idle for
          // lack of energy. Throttled to one event per wallet per 6 ticks
          // so /skip 100 doesn't spam 100 entries into Notifications.
          const unpoweredCount = gridPowered.length - poweredCount;
          if (unpoweredCount > 0) {
            const nowTick = getWorldTick();
            const last = this.lastUnpoweredEventTick.get(ownerId) ?? -999;
            if (nowTick - last >= 6) {
              this.lastUnpoweredEventTick.set(ownerId, nowTick);
              const sample = gridPowered.slice(poweredCount, poweredCount + 3).map((p) => p.parcelId);
              addEvent('building_unpowered', ownerId, {
                unpowered_count: unpoweredCount,
                powered_count: poweredCount,
                energy_short_by: unpoweredCount * ENERGY_PER_PRODUCING_BUILDING_PER_TICK,
                sample_parcels: sample,
              }, 'normal');
            }
          } else if (unpoweredCount === 0) {
            this.lastUnpoweredEventTick.delete(ownerId);
          }

          for (let i = 0; i < poweredCount; i++) {
            const p = gridPowered[i];
            const mult = TIER_MULTIPLIER[p.tier - 1] ?? 0;
            const produceAgentCount = p.produceAgentIds.length;
            // Production: every produce-agent + the base passive.
            const produceOut = mult * (1 + produceAgentCount);
            const resourceKey: 'food' | 'materials' | 'energy' =
              p.category === 'food' ? 'food'
              : p.category === 'materials' ? 'materials'
              : 'energy';
            resources[resourceKey] += produceOut;

            // Lifetime attribution: base output isn't attributed to any
            // agent; each produce agent gets `mult` per tick.
            for (const aid of p.produceAgentIds) {
              bumpAgentLifetimeStats(aid, { resources: { [resourceKey]: mult } });
            }

            // Crafting: each craft-agent atomically tries to consume
            // CRAFT_RESOURCES_PER_ITEM × tier_multiplier of the building's
            // input resource. If it can't afford this tick, it idles and
            // mints nothing — items only appear after the resource is
            // successfully debited, per owner clarification 2026-05-20.
            if (p.craftAgentIds.length > 0 && p.itemKind) {
              for (const aid of p.craftAgentIds) {
                const itemsThisAgent = mult;
                const cost = CRAFT_RESOURCES_PER_ITEM * itemsThisAgent;
                if (resources[resourceKey] < cost) continue; // idle this agent
                resources[resourceKey] -= cost;
                itemDeltas.set(
                  p.itemKind,
                  (itemDeltas.get(p.itemKind) ?? 0) + itemsThisAgent,
                );
                bumpAgentLifetimeStats(aid, { items: { [p.itemKind]: itemsThisAgent } });
                tickCraftMints.push({
                  agentId: aid,
                  parcelId: p.parcelId,
                  itemKind: p.itemKind,
                  quantity: itemsThisAgent,
                });
              }
            }
          }

          // Passive luxury (housing + civic) — no energy gating.
          resources.luxury += bucket.passiveLuxury;

          // UI Overhaul (rank model change 2026-05-20):
          // Rank progress now tracks lifetime luxury *earned*, not only
          // luxury *spent via items*. Only the canonical luxury chain
          // counts: passive emission from Housing/Civic buildings + the
          // luxury value of items used (via burnLuxuryItems). Legacy
          // building luxury credits resources.luxury but does NOT count
          // toward rank — those buildings will be removed once their
          // owners demolish/rebuild. Market buys also don't count.
          const producedLuxury = bucket.passiveLuxury;
          if (producedLuxury > 0) {
            const r2 = bumpLifetimeLuxury(ownerId, producedLuxury);
            if (r2.rankBefore !== r2.rankAfter && r2.rankAfter) {
              this.broadcast(MessageType.RANK_UP, {
                player_id: ownerId,
                from: r2.rankBefore,
                to: r2.rankAfter,
                lifetime: r2.lifetime,
              });
              addEvent('rank_up', ownerId, {
                from: r2.rankBefore, to: r2.rankAfter, lifetime: r2.lifetime,
              }, 'major');
            }
          }
        }

        // Persist any items crafted this tick + notify the client.
        if (itemDeltas.size > 0) {
          for (const [kind, qty] of itemDeltas) {
            addPlayerItems(ownerId, kind, qty);
          }
          const allItems = getPlayerItems(ownerId);
          const client = this.clients.find((c) => c.sessionId === sessionId);
          if (client) client.send(MessageType.ITEM_UPDATE, allItems);
        }
        // Emit a craft event per mint so the Notifications app can show
        // "your Lapidarist crafted 1 Cut Gemstone at Mine #42". Severity
        // 'normal' keeps it visible in the default filter.
        for (const m of tickCraftMints) {
          // Surface the workplace by business name (or building label
          // fallback) so the Notifications row reads "crafted 1 Cut
          // Gemstone at Aunt's Mine" rather than "at parcel #42".
          const wp = parcelById.get(m.parcelId);
          const btMint = (wp as { building_type?: string } | undefined)?.building_type;
          const buildingLabel = btMint ? (BUILDINGS[btMint as BuildingType]?.label ?? btMint) : null;
          const businessName = (wp as { business_name?: string } | undefined)?.business_name?.trim();
          addEvent('craft_item', ownerId, {
            agent_id: m.agentId,
            parcel: m.parcelId,
            parcel_name: businessName || buildingLabel || `parcel #${m.parcelId}`,
            item_kind: m.itemKind,
            quantity: m.quantity,
          }, 'normal');
        }

        // (Wage settlement moved out of the per-player loop — see the
        // wage-pass block below the forEach, which processes cross-
        // player pairs atomically and refreshes connected-player credits
        // here once the writes are settled.)

        // ── Phase 2 starvation state machine ─────────────────────────
        // Each active (non-dormant) agent eats 1 food/tick. If the pool
        // can't cover the full demand, ALL active agents starve this tick
        // and accumulate starvation_ticks. After STARVATION_GRACE_TICKS
        // consecutive starvation ticks, they go dormant. Reviving costs
        // REVIVE_COST_FOOD via /api/v1/agents/:id/revive.
        const myAgents = activeAgentsByOwner.get(ownerId) ?? [];
        const foodDemand = myAgents.length * FOOD_PER_AGENT_PER_TICK;
        if (foodDemand > 0) {
          if (resources.food >= foodDemand) {
            resources.food -= foodDemand;
            // Reset any non-zero starvation counters — the wallet fed
            // everyone this tick.
            for (const a of myAgents) {
              if (a.starvation_ticks > 0) setAgentStarvation(a.id, 0, null);
            }
          } else {
            // Underfed. Empty the food pool; everyone ticks toward dormancy.
            resources.food = 0;
            const tickNow = getWorldTick();
            for (const a of myAgents) {
              const next = (a.starvation_ticks ?? 0) + 1;
              if (next >= STARVATION_GRACE_TICKS) {
                setAgentStarvation(a.id, next, tickNow);
              } else {
                setAgentStarvation(a.id, next, null);
              }
            }
          }
        }

        updatePlayerResources(ownerId, resources);

        // Push state to the connected client.
        const client = this.clients.find((c) => c.sessionId === sessionId);
        if (client) {
          client.send(MessageType.RESOURCE_UPDATE, resources);
        }

        // Per-tick income notification — owner direction 2026-05-21:
        // emit one event per tick per player summarising the net change
        // across all four resources, the wage $AMETA earned, and the
        // luxury items minted. Severity 'minor' so /skip 100 doesn't
        // flood the default Notifications filter; the dedicated filter
        // can surface them when the player wants to audit a tick.
        const deltaFood = resources.food - beforeResources.food;
        const deltaMaterials = resources.materials - beforeResources.materials;
        const deltaEnergy = resources.energy - beforeResources.energy;
        const deltaLuxury = resources.luxury - beforeResources.luxury;
        const expectedWages = expectedWagesByOwner.get(ownerId) ?? 0;
        const itemsObj: Record<string, number> = {};
        for (const [kind, qty] of itemDeltas) itemsObj[kind] = qty;
        const hasAnyIncome =
          deltaFood !== 0 || deltaMaterials !== 0 ||
          deltaEnergy !== 0 || deltaLuxury !== 0 ||
          expectedWages > 0 || itemDeltas.size > 0;
        if (hasAnyIncome) {
          addEvent('tick_income', ownerId, {
            tick: getWorldTick(),
            food: deltaFood,
            materials: deltaMaterials,
            energy: deltaEnergy,
            luxury: deltaLuxury,
            wages: expectedWages,
            items: itemsObj,
          }, 'minor');
        }
      });

      // ── UI Overhaul: wage settlement (post per-player loop) ──────
      // Wages always go to the AGENT'S OWNER WALLET directly (no agent
      // balance + reclaim dance). For self-employment (parcel owner ==
      // agent owner), the server funds the wage. For cross-player
      // hires (Stage 3 spec §3), the PARCEL OWNER pays the AGENT
      // OWNER — that's the integral "payment received even if an
      // agent works at another user's properties" rule. If the parcel
      // owner can't afford the wage, no pay this tick (silent fail).
      // Wage model (owner direction 2026-05-31): EVERY work-role agent
      // stationed at a building is paid WORK_WAGE_AMETA_PER_TICK by the WORLD
      // TREASURY (the fee sink) — regardless of who owns the building. The
      // parcel owner pays nothing; there is no cross-player transfer. Pay only
      // while the treasury can afford it (stop once dry) so it never goes
      // negative. Wages move existing treasury $AMETA to players (sink→player),
      // not freshly-minted supply, so they are NOT recorded as GDP.
      const walletsTouchedByWages = new Set<string>();
      let treasuryBalance = getPlayerCreditsFromDb(WORLD_TREASURY_ID);
      for (const pair of wagePairs) {
        if (treasuryBalance < WORK_WAGE_AMETA_PER_TICK) break; // treasury dry — stop paying this tick
        treasuryBalance -= WORK_WAGE_AMETA_PER_TICK;
        updatePlayerCredits(WORLD_TREASURY_ID, treasuryBalance);
        const cur = getPlayerCreditsFromDb(pair.agentOwner);
        updatePlayerCredits(pair.agentOwner, cur + WORK_WAGE_AMETA_PER_TICK);
        bumpAgentLifetimeStats(pair.agentId, { wages: WORK_WAGE_AMETA_PER_TICK });
        walletsTouchedByWages.add(pair.agentOwner);
      }

      // Push CREDITS_UPDATE to any connected player whose wallet just
      // moved (paid or received). Also refreshes the cached PlayerData
      // credits field so subsequent server-side reads are consistent.
      if (walletsTouchedByWages.size > 0) {
        this.players.forEach((player, sessionId) => {
          if (!walletsTouchedByWages.has(player.id)) return;
          const fresh = getPlayerCreditsFromDb(player.id);
          player.credits = fresh;
          const client = this.clients.find((c) => c.sessionId === sessionId);
          if (client) client.send(MessageType.CREDITS_UPDATE, { credits: fresh });
        });
      }
    }

    // ---- Job system tick (gated by FEATURE_JOBS) ----
    if (features.JOBS) {
      for (const playerId of getActiveJobPlayerIds()) {
        const player = this.players.get(playerId);
        if (!player) continue;

        const client = this.clients.find((c) => c.sessionId === playerId);
        if (!client) continue;

        if (checkTimeExpired(playerId)) {
          client.send(MessageType.JOB_COMPLETE, { success: false, reason: 'Time expired', reward: 0 });
          continue;
        }

        const job = getActiveJob(playerId);
        if (!job) continue;

        if (job.jobType === 'shop_assistant') {
          const waitResult = tickWaitProgress(playerId, player.x, player.z, dt);
          if (waitResult) {
            if (waitResult.jobDone) {
              const newCredits = player.credits + waitResult.reward;
              updatePlayerCredits(playerId, newCredits);
              player.credits = newCredits;
              client.send(MessageType.JOB_COMPLETE, { success: true, reward: waitResult.reward });
              client.send(MessageType.CREDITS_UPDATE, { credits: player.credits });
            } else if (waitResult.shiftDone) {
              const updatedJob = getActiveJob(playerId);
              client.send(MessageType.JOB_UPDATE, {
                shiftComplete: true,
                shiftReward: waitResult.reward,
                shiftsCompleted: updatedJob?.shiftsCompleted ?? 0,
                maxShifts: updatedJob?.maxShifts ?? 3,
                waitProgress: 0,
              });
            }
          } else {
            client.send(MessageType.JOB_UPDATE, {
              currentObjective: job.currentObjective,
              waitProgress: job.waitProgress,
              remaining: getRemainingTime(playerId),
            });
          }
          continue;
        }

        const result = checkObjective(playerId, player.x, player.z);
        if (result.jobDone) {
          const newCredits = player.credits + result.reward;
          updatePlayerCredits(playerId, newCredits);
          player.credits = newCredits;
          client.send(MessageType.JOB_COMPLETE, { success: true, reward: result.reward });
          client.send(MessageType.CREDITS_UPDATE, { credits: player.credits });
        } else if (result.completed) {
          const updatedJob = getActiveJob(playerId);
          client.send(MessageType.JOB_UPDATE, {
            currentObjective: updatedJob?.currentObjective ?? 0,
            spotReward: result.reward,
            remaining: getRemainingTime(playerId),
          });
        } else {
          client.send(MessageType.JOB_UPDATE, {
            currentObjective: job.currentObjective,
            remaining: getRemainingTime(playerId),
          });
        }
      }
    }
  }

  onDispose() {
    console.log(`GameRoom disposed: ${this.roomId}`);
    if (this.offAgentChanged) { this.offAgentChanged(); this.offAgentChanged = null; }
    if (this.offWalletChanged) { this.offWalletChanged(); this.offWalletChanged = null; }
  }

  /**
   * Find the connected client whose persistent wallet id matches the
   * given walletId and push a fresh CREDITS_UPDATE. Called from the
   * wallet-events bus whenever the economy debits/credits/transfers.
   */
  private pushCreditsForWallet(walletId: string): void {
    if (!walletId) return;
    const lower = walletId.toLowerCase();
    this.players.forEach((player, sessionId) => {
      if (player.id.toLowerCase() !== lower) return;
      const fresh = getPlayerCreditsFromDb(player.id);
      player.credits = fresh;
      const client = this.clients.find((c) => c.sessionId === sessionId);
      if (client) client.send(MessageType.CREDITS_UPDATE, { credits: fresh });
    });
  }
}
