import { Room, Client } from 'colyseus';
import { GameState, PlayerData } from '../state/GameState';
import {
  TICK_RATE,
  PLAYER_SPEED,
  SPRINT_MULTIPLIER,
  WORLD_HALF,
  MessageType,
  PlayerInput,
  BUS_STOPS,
  features,
  Appearance,
  DEFAULT_APPEARANCE,
  BUILDINGS,
  BuildingType,
  BuildingCategory,
  INCOME_TICK_MS,
  ResourceType,
  TICK_PRODUCTION,
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
  PROPERTY_FEE_BPS,
  BPS_DENOMINATOR,
  consumesEnergy,
  emitsPassiveLuxury,
  parcelWorldPos,
} from '@gamestu/shared';
import {
  getOrCreatePlayer,
  savePlayerPosition,
  getPlayerCredits as getPlayerCreditsFromDb,
  updatePlayerCredits,
  seedParcels,
  claimAndBuild,
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
  tickReputation,
  getRawDb,
  getAllAgents,
  setAgentStarvation,
  getPlayerItems,
  addPlayerItems,
  burnLuxuryItems,
} from '../db';
import { advanceWorldTick, recordGdp } from '../world';
import { runAutopilotPass } from '../autopilot';
import { rankFor } from '../ranks';
import { economy, WORLD_TREASURY_ID } from '../economy';
import { onAgentChanged } from '../events/agentEvents';
import { generateUnitsForParcel, buildingHasUnits, tickPropertyIncome, backfillSubUnits } from '../properties';
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

  /** Latest input per player, consumed each server tick. */
  private pendingInputs = new Map<string, PlayerInput>();

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

    // ---- Phase C: backfill sub-units for any pre-existing apartments
    // and offices that were built before the multi-floor system landed.
    const back = backfillSubUnits();
    if (back.created > 0) {
      console.log(`[GameRoom] backfilled ${back.created} sub-units across ${back.processed} multi-floor parcels`);
    }

    this.onMessage(MessageType.PLAYER_INPUT, (client: Client, input: PlayerInput) => {
      const player = this.players.get(client.sessionId);
      if (!player) return;

      if (
        typeof input.forward !== 'boolean' ||
        typeof input.backward !== 'boolean' ||
        typeof input.left !== 'boolean' ||
        typeof input.right !== 'boolean' ||
        typeof input.jump !== 'boolean'
      ) {
        return;
      }
      if (input.sprint !== undefined && typeof input.sprint !== 'boolean') return;

      if (input.forward || input.backward || input.left || input.right) {
        this.pendingInputs.set(client.sessionId, input);
      } else {
        this.pendingInputs.delete(client.sessionId);
      }

      // Camera yaw travels with every input packet. Store it so the
      // per-tick update() can resolve WASD into world-space motion even
      // when the client isn't moving this exact tick.
      if (typeof input.rotation === 'number') {
        player.rotation = input.rotation;
      }
    });

    this.onMessage(MessageType.CHAT, (client: Client, message: { text: string }) => {
      if (typeof message.text !== 'string') return;
      const text = message.text.trim().slice(0, 200);
      if (text.length === 0) return;

      const player = this.players.get(client.sessionId);
      const senderName = player?.name ?? 'Unknown';

      this.broadcast(MessageType.CHAT, {
        senderId: this.pid(client.sessionId),
        senderName,
        text,
      });
    });

    this.onMessage(MessageType.PLAYER_COLOR, (client: Client, data: { color: string }) => {
      const player = this.players.get(client.sessionId);
      if (!player) return;
      if (typeof data.color !== 'string') return;
      player.color = data.color;
      player.appearance.shirt_color = data.color;
      savePlayerAppearance(this.pid(client.sessionId), JSON.stringify(player.appearance));
      this.broadcast(MessageType.PLAYER_UPDATE, this.snapshotPlayer(player));
    });

    this.onMessage(MessageType.UPDATE_APPEARANCE, (client: Client, data: Partial<Appearance>) => {
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
      // Phase 4: enforce minRank gate before charging anything.
      if (TIER_INDEX[rankFor(ownerId)] < TIER_INDEX[spec.minRank]) {
        client.send(MessageType.CLAIM_PARCEL, {
          error: 'rank_required',
          required_rank: spec.minRank,
          current_rank: rankFor(ownerId),
        });
        return;
      }
      const result = claimAndBuild(
        ownerId, data.parcelId, data.building_type, spec.cost, spec.label, spec.materialCost,
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
      const unitsCreated = buildingHasUnits(data.building_type)
        ? generateUnitsForParcel(data.parcelId, data.building_type, ownerId)
        : 0;
      addEvent('claim_and_build', ownerId, {
        parcel: data.parcelId, building: data.building_type,
        cost_ameta: spec.cost + LAND_COST, cost_materials: spec.materialCost,
        units_created: unitsCreated,
      }, 'major');
      console.log(`${player.name} claimed parcel #${data.parcelId} + built ${spec.label} (-${spec.cost + LAND_COST} $AMETA, -${spec.materialCost} materials)`);
    });

    this.onMessage(MessageType.UPDATE_BUSINESS, (client: Client, data: { parcelId: number; name?: string; type?: string; color?: string; height?: number }) => {
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
      const player = this.players.get(client.sessionId);
      if (!player) return;
      const stop = BUS_STOPS[data.stopIndex];
      if (!stop) return;
      player.x = stop.x;
      player.z = stop.z;
      this.broadcast(MessageType.PLAYER_UPDATE, this.snapshotPlayer(player));
    });

    // ---- BUILD_STRUCTURE: place a typed building on an owned parcel ----
    this.onMessage(MessageType.BUILD_STRUCTURE, (client: Client, data: { parcelId: number; buildingType: string }) => {
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
      const unitsCreated = buildingHasUnits(data.buildingType)
        ? generateUnitsForParcel(data.parcelId, data.buildingType, ownerId)
        : 0;

      client.send(MessageType.CREDITS_UPDATE, { credits: player.credits });
      this.broadcast(MessageType.PARCEL_UPDATE, {
        id: data.parcelId,
        owner_id: ownerId,
        business_name: spec.label,
        business_type: data.buildingType,
      });
      addEvent('build', ownerId, { parcel: data.parcelId, building: data.buildingType, cost: spec.cost, units_created: unitsCreated }, 'major');
      console.log(`${player.name} built ${spec.label} on parcel #${data.parcelId} (-${spec.cost} credits)`);
    });

    // ---- WORK: produce resources from owned buildings ----
    this.onMessage(MessageType.WORK, (client: Client) => {
      const player = this.players.get(client.sessionId);
      if (!player) return;

      const ownerId = this.pid(client.sessionId);
      const parcels = getPlayerParcels(ownerId);
      const resources = getPlayerResources(ownerId);
      let creditsEarned = 0;
      const produced: Record<string, number> = {};

      for (const parcel of parcels) {
        const bt = (parcel as any).building_type as string | null;
        if (!bt) continue;
        const spec = BUILDINGS[bt as BuildingType];
        if (!spec) continue;

        if (spec.produces && spec.amount) {
          const key = spec.produces as keyof typeof resources;
          resources[key] = (resources[key] || 0) + spec.amount;
          produced[key] = (produced[key] || 0) + spec.amount;
        }
        if (spec.income > 0) {
          creditsEarned += spec.income;
        }
      }

      if (creditsEarned > 0) {
        player.credits += creditsEarned;
        updatePlayerCredits(ownerId, player.credits);
        client.send(MessageType.CREDITS_UPDATE, { credits: player.credits });
      }
      updatePlayerResources(ownerId, resources);
      client.send(MessageType.WORK_RESULT, { produced, creditsEarned, resources });
      client.send(MessageType.RESOURCE_UPDATE, resources);
      addEvent('work', ownerId, { produced, creditsEarned }, 'minor');
    });

    // (Legacy Colyseus TRADE + MARKET_PRICES handlers removed 2026-05-16.
    //  All resource trading goes through the REST order book — see
    //  POST /api/v1/market/order. Humans use their wallet session token,
    //  agents use their tl_sk_ API key; same endpoint, one ledger.)

    // EXPLORE action removed in Phase 0 (spec §12 deprecation):
    // the paid "teleport to a random parcel" mechanic served no design
    // purpose in the new tier+rank loop. Players move with WASD; parcel
    // discovery happens via the World Map UI.

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

      // Broadcast the visual effect to nearby clients (Phase 3 stub —
      // client-side particle system reacts to this).
      this.broadcast(MessageType.BURN_EFFECT, {
        player_id: ownerId,
        item_kind: data.item_kind,
        quantity: data.quantity,
        x: player.x, z: player.z,
      });

      addEvent(
        'burn_luxury', ownerId,
        { item_kind: data.item_kind, quantity: data.quantity, rank_points_gained: r.gained, lifetime: r.lifetime },
        // Spec §6: global feed announcement when a single burn ≥ 1000 rank points.
        (r.gained ?? 0) >= 1000 ? 'major' : 'minor',
      );
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
    // Persistent player identity. There are three paths:
    //   1. Wallet user: client passes authToken → we look up the wallet
    //      address it was minted for, use that as playerId. Token gates
    //      claiming a wallet identity (anti-impersonation).
    //   2. Wallet address claimed without token → REJECT. Otherwise anyone
    //      could pass `0x...` and steal a wallet's data.
    //   3. Guest: client passes a UUID it stored in localStorage. We trust
    //      it (guests have no signing key); worst case is "guest progress
    //      stolen by someone who guessed your UUID", which is negligible.
    const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
    const PID_RE = /^[A-Za-z0-9_-]{8,64}$/;

    let persistentId: string;
    if (typeof options.authToken === 'string' && options.authToken.length > 0) {
      const tokenPid = getAuthSessionPlayerId(options.authToken);
      if (!tokenPid) {
        // Token expired/invalid — kick the client so it can fall back to guest.
        client.error(401, 'auth_token_invalid');
        client.leave(4001, 'auth_token_invalid');
        return;
      }
      persistentId = tokenPid;
    } else if (typeof options.playerId === 'string' && WALLET_RE.test(options.playerId)) {
      // Wallet address without a token = impersonation attempt.
      client.error(403, 'wallet_requires_auth_token');
      client.leave(4003, 'wallet_requires_auth_token');
      return;
    } else if (typeof options.playerId === 'string' && PID_RE.test(options.playerId)) {
      persistentId = options.playerId;
    } else {
      persistentId = client.sessionId;
    }
    this.pidBySession.set(client.sessionId, persistentId);

    const displayName = options.name || `Player_${persistentId.slice(0, 4)}`;
    const row = getOrCreatePlayer(persistentId, displayName);

    let appearance: Appearance = { ...DEFAULT_APPEARANCE };
    if (row.appearance) {
      try {
        const parsed = JSON.parse(row.appearance);
        appearance = { ...DEFAULT_APPEARANCE, ...parsed };
      } catch (_) {
        // Corrupt JSON — fall back to defaults
      }
    }

    const player: PlayerData = {
      id: persistentId,
      name: row.name,
      x: row.x,
      y: row.y,
      z: row.z,
      rotation: 0,
      credits: row.credits,
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

  onLeave(client: Client) {
    const player = this.players.get(client.sessionId);
    const persistentId = this.pid(client.sessionId);
    if (player) {
      savePlayerPosition(persistentId, player.x, player.y, player.z);
      console.log(`${player.name} left (sid=${client.sessionId}, pid=${persistentId}) — position saved`);
    }
    this.players.delete(client.sessionId);
    this.pendingInputs.delete(client.sessionId);
    this.pidBySession.delete(client.sessionId);
    cancelJob(client.sessionId);
    if (features.TUTORIAL) {
      cancelTutorial(client.sessionId);
    }
    this.broadcast(MessageType.PLAYER_LEAVE, { id: persistentId });
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
    const seen = new Set<string>();
    for (const a of fresh) {
      seen.add(a.id);
      const existing = this.agentPlayers.get(a.id);
      if (existing) {
        // Owner may have toggled autopilot on/off via the REST endpoint;
        // propagate that to the broadcast so the AUTO/AGENT badge updates.
        const wanted: 'auto' | 'agent' = a.autopilot_enabled === 1 ? 'auto' : 'agent';
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
      const pd: PlayerData = {
        id: a.id,
        name: a.name,
        x: row.x, y: row.y, z: row.z,
        rotation: 0,
        credits: row.credits,
        color: appearance.shirt_color,
        appearance,
        bot_kind: a.autopilot_enabled === 1 ? 'auto' : 'agent',
        // Start with no pending target — they stand still until the
        // first autopilot tick assigns a workplace/spawn waypoint.
        targetX: row.x, targetY: row.y, targetZ: row.z,
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

  update(deltaTime: number) {
    const dt = deltaTime / 1000;

    // ---- Step agents toward their waypoints ----
    // Walks each agent toward (targetX, targetZ) at PLAYER_SPEED. When
    // within arrival epsilon they snap and stop (target == position).
    // Position diffs propagate to clients via the periodic PLAYER_STATE
    // broadcast below, which includes agents — the client lerps over
    // the 100ms broadcast interval, so the result is a smooth walk.
    this.stepAgents(dt);

    this.pendingInputs.forEach((input, sessionId) => {
      const player = this.players.get(sessionId);
      if (!player) return;

      const sprintActive = input.sprint === true;
      const speed = PLAYER_SPEED * (sprintActive ? SPRINT_MULTIPLIER : 1) * dt;

      // Movement is relative to camera yaw (player.rotation, in radians,
      // set from input.rotation). forward = (sin(yaw), cos(yaw)) in XZ;
      // right = (cos(yaw), -sin(yaw)). Diagonal input is normalized.
      const yaw = player.rotation || 0;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);

      let mx = 0;
      let mz = 0;
      if (input.forward) { mx += fx; mz += fz; }
      if (input.backward) { mx -= fx; mz -= fz; }
      if (input.right) { mx += rx; mz += rz; }
      if (input.left) { mx -= rx; mz -= rz; }

      const len = Math.hypot(mx, mz);
      if (len > 0) {
        mx /= len;
        mz /= len;
        player.x += mx * speed;
        player.z += mz * speed;
      }
      // NOTE: player.rotation is authoritative camera yaw set from input.rotation.
      // We deliberately do NOT override it with movement direction — that would
      // fight the "camera behind player" feel. Strafing with A/D keeps the
      // character facing the camera's forward, same as a TPS shooter.

      player.x = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, player.x));
      player.z = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, player.z));
    });

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

      // Phase B.2 reputation: each owned shop consumes 1 luxury; owner
      // gains +1 reputation per consumed unit. Done after autopilot so
      // freshly-bought luxury counts.
      tickReputation();

      // Phase C.4: per-unit passive income to sub-unit owners. GDP
      // accumulator already records the total inside tickPropertyIncome.
      tickPropertyIncome();

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
      //   • Legacy types (shop/hall/etc.) still produce via the deprecated
      //     TICK_PRODUCTION shim so existing players don't lose value.
      //   • $AMETA wages for role='work' agents and rank production
      //     bonuses are wired in Phase 4.
      //
      // Step A: snapshot agents once + index by owner + by workplace parcel.
      // Dormant agents skip everything — they don't produce, don't eat,
      // don't accumulate starvation. Only an owner-initiated `revive`
      // (which costs 100 food) brings them back.
      const allAgents = getAllAgents();
      const activeAgentsByOwner = new Map<string, typeof allAgents>();
      const produceAgentsByParcel = new Map<number, number>();
      const craftAgentsByParcel = new Map<number, number>();
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
        if (a.role === 'produce') {
          produceAgentsByParcel.set(
            a.workplace_parcel_id,
            (produceAgentsByParcel.get(a.workplace_parcel_id) ?? 0) + 1,
          );
        } else if (a.role === 'craft') {
          craftAgentsByParcel.set(
            a.workplace_parcel_id,
            (craftAgentsByParcel.get(a.workplace_parcel_id) ?? 0) + 1,
          );
        }
      }

      // Step B: bucket owners' producing buildings + passive luxury.
      interface Producer {
        parcelId: number;
        category: BuildingCategory;
        tier: number;
        produceAgents: number;
        craftAgents: number;
        itemKind: LuxuryItemKind | null;
      }
      interface OwnerBucket {
        producers: Producer[];                 // need 1 energy each
        passiveLuxury: number;                 // sum of housing/civic
        legacyAdd: { food: number; materials: number; energy: number; luxury: number };
      }
      const byOwner = new Map<string, OwnerBucket>();
      const getBucket = (id: string): OwnerBucket => {
        let b = byOwner.get(id);
        if (!b) {
          b = {
            producers: [],
            passiveLuxury: 0,
            legacyAdd: { food: 0, materials: 0, energy: 0, luxury: 0 },
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
            produceAgents: produceAgentsByParcel.get(row.id) ?? 0,
            craftAgents: craftAgentsByParcel.get(row.id) ?? 0,
            itemKind: ITEM_FOR_BUILDING[bt] ?? null,
          });
        } else if (emitsPassiveLuxury(bt)) {
          const idx = Math.max(0, spec.tier - 1);
          b.passiveLuxury += LUXURY_PASSIVE_PER_TICK_BY_TIER[idx] ?? 0;
        } else if (spec.category === 'legacy') {
          // Legacy bridge — TICK_PRODUCTION shim keeps shop/skyscraper/etc.
          // earning until the player demolishes and rebuilds.
          const tick = TICK_PRODUCTION[bt];
          if (tick) b.legacyAdd[tick.resource] += tick.rate;
        }
      }

      // Step C: settle each connected player.
      this.players.forEach((player, sessionId) => {
        const ownerId = player.id;
        const bucket = byOwner.get(ownerId);
        const resources = getPlayerResources(ownerId);

        const itemDeltas = new Map<LuxuryItemKind, number>();
        if (bucket) {
          // Producing buildings: gated by current energy pool. Sort by
          // parcelId so the priority is deterministic (oldest parcel
          // gets powered first if there's a shortage).
          const sorted = [...bucket.producers].sort((a, b2) => a.parcelId - b2.parcelId);
          const poweredCount = Math.min(
            sorted.length,
            Math.floor(resources.energy / ENERGY_PER_PRODUCING_BUILDING_PER_TICK),
          );
          resources.energy -= poweredCount * ENERGY_PER_PRODUCING_BUILDING_PER_TICK;

          for (let i = 0; i < poweredCount; i++) {
            const p = sorted[i];
            const mult = TIER_MULTIPLIER[p.tier - 1] ?? 0;
            // Production: every produce-agent + the base passive.
            const produceOut = mult * (1 + p.produceAgents);
            if (p.category === 'food')           resources.food      += produceOut;
            else if (p.category === 'materials') resources.materials += produceOut;
            else if (p.category === 'energy')    resources.energy    += produceOut;

            // Crafting: each craft-agent consumes CRAFT_RESOURCES_PER_ITEM
            // × tier_multiplier of the building's input resource per tick
            // and mints `tier_multiplier` items. Per spec §4: "If a
            // building lacks its required 1 energy for a tick … no agents
            // assigned to that building can craft either" — already
            // guaranteed because we're inside the powered-count block.
            if (p.craftAgents > 0 && p.itemKind) {
              for (let c = 0; c < p.craftAgents; c++) {
                const itemsThisAgent = mult;
                const cost = CRAFT_RESOURCES_PER_ITEM * itemsThisAgent;
                let available: number;
                if (p.category === 'food')      available = resources.food;
                else if (p.category === 'materials') available = resources.materials;
                else /* energy */               available = resources.energy;
                if (available < cost) break; // idle this agent; rest can also try
                if (p.category === 'food')           resources.food      -= cost;
                else if (p.category === 'materials') resources.materials -= cost;
                else if (p.category === 'energy')    resources.energy    -= cost;
                itemDeltas.set(
                  p.itemKind,
                  (itemDeltas.get(p.itemKind) ?? 0) + itemsThisAgent,
                );
              }
            }
          }

          // Passive luxury (housing + civic) — no energy gating.
          resources.luxury += bucket.passiveLuxury;

          // Legacy types contribute their old flat rates (no energy gate,
          // since we don't want to break ownership economics mid-migration).
          resources.food      += bucket.legacyAdd.food;
          resources.materials += bucket.legacyAdd.materials;
          resources.energy    += bucket.legacyAdd.energy;
          resources.luxury    += bucket.legacyAdd.luxury;
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
      });
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
  }
}
