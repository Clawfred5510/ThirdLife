import { Room, Client } from 'colyseus';
import { GameState, PlayerData } from '../state/GameState';
import { TICK_RATE, PLAYER_SPEED, WORLD_HALF, MessageType, PlayerInput, BUS_STOPS, features } from '@gamestu/shared';
import { getOrCreatePlayer, savePlayerPosition, purchaseProperty, getPlayerCredits as getPlayerCreditsFromDb, updatePlayerCredits, getPlayerTotalRevenue, seedParcels, claimParcel, updateBusiness as updateBusinessInDb, getAllParcels } from '../db';
import { startJob, getActiveJob, cancelJob, checkObjective, tickWaitProgress, checkTimeExpired, getRemainingTime, getJobBoard, getActiveJobPlayerIds } from '../systems/jobs';
import { startTutorialIfNeeded, cancelTutorial } from '../systems/tutorial';

const PLAYER_BROADCAST_INTERVAL_MS = 100; // 10 Hz

export class GameRoom extends Room<GameState> {
  maxClients = 50;

  /** Server-side player map (NOT in Colyseus schema — see state/GameState.ts). */
  private players = new Map<string, PlayerData>();

  /** Latest input per player, consumed each server tick. */
  private pendingInputs = new Map<string, PlayerInput>();

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
        senderId: client.sessionId,
        senderName,
        text,
      });
    });

    this.onMessage(MessageType.BUY_PROPERTY, (client: Client, data: { propertyId: number }) => {
      const player = this.players.get(client.sessionId);
      if (!player) return;
      if (typeof data.propertyId !== 'number') return;

      const success = purchaseProperty(data.propertyId, client.sessionId);
      if (success) {
        player.credits = getPlayerCreditsFromDb(client.sessionId);
        client.send(MessageType.CREDITS_UPDATE, { credits: player.credits });
        this.broadcast(MessageType.PROPERTY_UPDATE, {
          propertyId: data.propertyId,
          ownerId: client.sessionId,
          ownerName: player.name,
        });
      } else {
        client.send(MessageType.CREDITS_UPDATE, { credits: player.credits, error: 'Purchase failed' });
      }
    });

    this.onMessage(MessageType.PLAYER_COLOR, (client: Client, data: { color: string }) => {
      const player = this.players.get(client.sessionId);
      if (!player) return;
      if (typeof data.color !== 'string') return;
      player.color = data.color;
      this.broadcast(MessageType.PLAYER_UPDATE, this.snapshotPlayer(player));
    });

    this.onMessage(MessageType.CLAIM_PARCEL, (client: Client, data: { parcelId: number }) => {
      const player = this.players.get(client.sessionId);
      if (!player) return;
      if (typeof data.parcelId !== 'number' || data.parcelId < 0 || data.parcelId > 2499) return;

      const success = claimParcel(data.parcelId, client.sessionId);
      if (success) {
        player.credits = getPlayerCreditsFromDb(client.sessionId);
        client.send(MessageType.CREDITS_UPDATE, { credits: player.credits });
        this.broadcast(MessageType.PARCEL_UPDATE, {
          id: data.parcelId,
          owner_id: client.sessionId,
          owner_name: player.name,
        });
        console.log(`${player.name} claimed parcel #${data.parcelId}`);
      } else {
        client.send(MessageType.CLAIM_PARCEL, { error: 'Claim failed (already claimed or insufficient credits)' });
      }
    });

    this.onMessage(MessageType.UPDATE_BUSINESS, (client: Client, data: { parcelId: number; name?: string; type?: string; color?: string; height?: number }) => {
      const player = this.players.get(client.sessionId);
      if (!player) return;
      if (typeof data.parcelId !== 'number' || data.parcelId < 0 || data.parcelId > 2499) return;

      const success = updateBusinessInDb(data.parcelId, client.sessionId, data);
      if (success) {
        this.broadcast(MessageType.PARCEL_UPDATE, {
          id: data.parcelId,
          owner_id: client.sessionId,
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

  onJoin(client: Client, options: { name?: string }) {
    const displayName = options.name || `Player_${client.sessionId.slice(0, 4)}`;
    const row = getOrCreatePlayer(client.sessionId, displayName);

    const player: PlayerData = {
      id: client.sessionId,
      name: row.name,
      x: row.x,
      y: row.y,
      z: row.z,
      rotation: 0,
      credits: row.credits,
      color: '#3366cc',
    };
    this.players.set(client.sessionId, player);

    // Tell the joining client about itself + all current players
    client.send(MessageType.PLAYER_STATE, {
      self: client.sessionId,
      players: Array.from(this.players.values()).map((p) => this.snapshotPlayer(p)),
    });

    // Tell everyone else about the new player
    this.broadcast(MessageType.PLAYER_JOIN, this.snapshotPlayer(player), { except: client });

    // Initial credits UI sync
    client.send(MessageType.CREDITS_UPDATE, { credits: player.credits });

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

    console.log(`${player.name} joined (${client.sessionId}) — credits: ${player.credits}`);
  }

  onLeave(client: Client) {
    const player = this.players.get(client.sessionId);
    if (player) {
      savePlayerPosition(client.sessionId, player.x, player.y, player.z);
      console.log(`${player.name} left (${client.sessionId}) — position saved`);
    }
    this.players.delete(client.sessionId);
    this.pendingInputs.delete(client.sessionId);
    cancelJob(client.sessionId);
    if (features.TUTORIAL) {
      cancelTutorial(client.sessionId);
    }
    this.broadcast(MessageType.PLAYER_LEAVE, { id: client.sessionId });
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
    };
  }

  update(deltaTime: number) {
    const dt = deltaTime / 1000;

    this.pendingInputs.forEach((input, sessionId) => {
      const player = this.players.get(sessionId);
      if (!player) return;

      const speed = PLAYER_SPEED * dt;

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

    // ---- Passive revenue tick (every 60 seconds) ----
    this.lastRevenueTick += deltaTime;
    if (this.lastRevenueTick >= 60000) {
      this.lastRevenueTick = 0;
      this.players.forEach((player, sessionId) => {
        const revenue = getPlayerTotalRevenue(sessionId);
        if (revenue > 0) {
          const newCredits = player.credits + revenue;
          updatePlayerCredits(sessionId, newCredits);
          player.credits = newCredits;
          const client = this.clients.find((c) => c.sessionId === sessionId);
          if (client) {
            client.send(MessageType.CREDITS_UPDATE, { credits: player.credits });
          }
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
