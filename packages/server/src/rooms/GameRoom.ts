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
  INCOME_TICK_MS,
  BASE_MARKET_PRICES,
  ResourceType,
  RESOURCE_TYPES,
  EXPLORE_COST,
  TICK_PRODUCTION,
  FOOD_PER_AGENT_PER_TICK,
  ENERGY_PER_INCOME_BUILDING_PER_TICK,
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
} from '../db';
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

  onCreate() {
    this.setState(new GameState());
    this.setSimulationInterval((deltaTime) => this.update(deltaTime), 1000 / TICK_RATE);

    // ---- Seed parcels into DB ----
    seedParcels();
    const allParcels = getAllParcels();
    console.log(`[GameRoom] ${allParcels.length} parcels in DB`);

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
      const result = claimAndBuild(
        ownerId, data.parcelId, data.building_type, spec.cost, spec.label,
      );
      if (!result.ok) {
        client.send(MessageType.CLAIM_PARCEL, {
          error: result.reason,
          detail: result.reason === 'insufficient_balance' ? { required: spec.cost + 150000 } : undefined,
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
      addEvent('claim_and_build', ownerId, {
        parcel: data.parcelId, building: data.building_type, cost: spec.cost + 150000,
      });
      console.log(`${player.name} claimed parcel #${data.parcelId} + built ${spec.label} (-${spec.cost + 150000} $AMETA)`);
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
      if (player.credits < spec.cost) { client.send(MessageType.BUILD_STRUCTURE, { error: 'Insufficient credits', cost: spec.cost }); return; }

      const ownerId = this.pid(client.sessionId);
      const parcels = getPlayerParcels(ownerId);
      const parcel = parcels.find(p => p.id === data.parcelId);
      if (!parcel) { client.send(MessageType.BUILD_STRUCTURE, { error: 'You do not own this parcel' }); return; }

      player.credits -= spec.cost;
      updatePlayerCredits(ownerId, player.credits);
      setBuildingType(data.parcelId, data.buildingType);
      updateBusinessInDb(data.parcelId, ownerId, { type: data.buildingType, name: spec.label });

      client.send(MessageType.CREDITS_UPDATE, { credits: player.credits });
      this.broadcast(MessageType.PARCEL_UPDATE, {
        id: data.parcelId,
        owner_id: ownerId,
        business_name: spec.label,
        business_type: data.buildingType,
      });
      addEvent('build', ownerId, { parcel: data.parcelId, building: data.buildingType, cost: spec.cost });
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
      addEvent('work', ownerId, { produced, creditsEarned });
    });

    // ---- TRADE: sell resources at market prices ----
    this.onMessage(MessageType.TRADE, (client: Client, data: { resource: string; quantity: number }) => {
      const player = this.players.get(client.sessionId);
      if (!player) return;
      if (typeof data.resource !== 'string' || typeof data.quantity !== 'number' || data.quantity <= 0) return;
      if (!RESOURCE_TYPES.includes(data.resource as ResourceType)) { client.send(MessageType.TRADE_RESULT, { error: 'Invalid resource' }); return; }

      const ownerId = this.pid(client.sessionId);
      const resources = getPlayerResources(ownerId);
      const key = data.resource as keyof typeof resources;
      if (resources[key] < data.quantity) { client.send(MessageType.TRADE_RESULT, { error: 'Insufficient resource' }); return; }

      const price = BASE_MARKET_PRICES[data.resource as ResourceType];
      const earnings = Math.floor(price * data.quantity);
      resources[key] -= data.quantity;
      player.credits += earnings;
      updatePlayerCredits(ownerId, player.credits);
      updatePlayerResources(ownerId, resources);

      client.send(MessageType.CREDITS_UPDATE, { credits: player.credits });
      client.send(MessageType.RESOURCE_UPDATE, resources);
      client.send(MessageType.TRADE_RESULT, { sold: data.resource, quantity: data.quantity, earned: earnings });
      addEvent('trade', ownerId, { resource: data.resource, quantity: data.quantity, earned: earnings });
    });

    // ---- MARKET_PRICES: return current prices ----
    this.onMessage(MessageType.MARKET_PRICES, (client: Client) => {
      client.send(MessageType.MARKET_PRICES, BASE_MARKET_PRICES);
    });

    // ---- EXPLORE: move to random unclaimed parcel ----
    this.onMessage(MessageType.EXPLORE, (client: Client) => {
      const player = this.players.get(client.sessionId);
      if (!player) return;
      if (player.credits < EXPLORE_COST) { client.send(MessageType.EXPLORE, { error: 'Insufficient credits' }); return; }

      const allParcels = getAllParcels();
      const unclaimed = allParcels.filter(p => !p.owner_id);
      if (unclaimed.length === 0) { client.send(MessageType.EXPLORE, { error: 'No unclaimed parcels' }); return; }

      const target = unclaimed[Math.floor(Math.random() * unclaimed.length)];
      const ownerId = this.pid(client.sessionId);
      player.credits -= EXPLORE_COST;
      updatePlayerCredits(ownerId, player.credits);
      player.x = target.grid_x * 48 - 1200 + 20; // approx world coords
      player.z = target.grid_y * 48 - 1200 + 20;

      client.send(MessageType.CREDITS_UPDATE, { credits: player.credits });
      client.send(MessageType.EXPLORE, { parcel: { id: target.id, grid_x: target.grid_x, grid_y: target.grid_y } });
      this.broadcast(MessageType.PLAYER_UPDATE, this.snapshotPlayer(player));
      addEvent('explore', ownerId, { parcel: target.id });
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

    // Tell the joining client about itself + all current players
    client.send(MessageType.PLAYER_STATE, {
      self: persistentId,
      players: Array.from(this.players.values()).map((p) => this.snapshotPlayer(p)),
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
    };
  }

  update(deltaTime: number) {
    const dt = deltaTime / 1000;

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
    this.lastBroadcastTick += deltaTime;
    if (this.lastBroadcastTick >= PLAYER_BROADCAST_INTERVAL_MS && this.players.size > 0) {
      this.lastBroadcastTick = 0;
      this.broadcast(MessageType.PLAYER_STATE, {
        players: Array.from(this.players.values()).map((p) => this.snapshotPlayer(p)),
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

      interface OwnerBucket {
        produce: { food: number; materials: number; energy: number; luxury: number };
        incomeBuildings: number;    // count of buildings with income > 0
        pendingIncomePer: number[]; // income per building (same length as incomeBuildings)
      }
      const byOwner = new Map<string, OwnerBucket>();
      const getBucket = (id: string) => {
        let b = byOwner.get(id);
        if (!b) {
          b = { produce: { food: 0, materials: 0, energy: 0, luxury: 0 }, incomeBuildings: 0, pendingIncomePer: [] };
          byOwner.set(id, b);
        }
        return b;
      };

      for (const row of getOwnedBuiltParcels()) {
        const spec = BUILDINGS[row.building_type as BuildingType];
        if (!spec) continue;
        const tick = TICK_PRODUCTION[row.building_type as BuildingType];
        const b = getBucket(row.owner_id);
        if (tick) b.produce[tick.resource] += tick.rate;
        if (spec.income > 0) {
          b.incomeBuildings += 1;
          b.pendingIncomePer.push(spec.income);
        }
      }

      this.players.forEach((player, sessionId) => {
        // byOwner is keyed by persistent owner_id from the parcels table;
        // DB resource/credits ops use the same persistent ID. The
        // sessionId here is only used to find the network client to push to.
        const ownerId = player.id;
        const bucket = byOwner.get(ownerId);
        const resources = getPlayerResources(ownerId);

        // 1. Apply tick production
        if (bucket) {
          resources.food += bucket.produce.food;
          resources.materials += bucket.produce.materials;
          resources.energy += bucket.produce.energy;
          resources.luxury += bucket.produce.luxury;
        }

        // 2. Agent food consumption (floor at 0 — going "inactive" is a
        // soft state; we still deduct so the penalty is economic, not
        // mechanical. No negatives.)
        resources.food = Math.max(0, resources.food - FOOD_PER_AGENT_PER_TICK);

        // 3. Burn energy to pay income. Each income building needs
        // ENERGY_PER_INCOME_BUILDING_PER_TICK energy; buildings beyond the
        // available energy pay nothing this tick.
        let paidIncome = 0;
        if (bucket && bucket.incomeBuildings > 0) {
          const maxPayouts = Math.floor(resources.energy / ENERGY_PER_INCOME_BUILDING_PER_TICK);
          const payouts = Math.min(maxPayouts, bucket.incomeBuildings);
          resources.energy -= payouts * ENERGY_PER_INCOME_BUILDING_PER_TICK;
          // Pay the `payouts` highest-income buildings for fairness.
          const sorted = [...bucket.pendingIncomePer].sort((a, b) => b - a);
          for (let i = 0; i < payouts; i++) paidIncome += sorted[i] ?? 0;
        }

        updatePlayerResources(ownerId, resources);
        if (paidIncome > 0) {
          const newCredits = player.credits + paidIncome;
          updatePlayerCredits(ownerId, newCredits);
          player.credits = newCredits;
        }

        // Push state to the connected client
        const client = this.clients.find((c) => c.sessionId === sessionId);
        if (client) {
          client.send(MessageType.RESOURCE_UPDATE, resources);
          if (paidIncome > 0) client.send(MessageType.CREDITS_UPDATE, { credits: player.credits });
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
  }
}
