import { Room, Client } from 'colyseus';
import { GameState, PlayerState } from '../state/GameState';
import { TICK_RATE, PLAYER_SPEED, WORLD_HALF, MessageType, PlayerInput, BUS_STOPS } from '@gamestu/shared';
import { getOrCreatePlayer, savePlayerPosition, purchaseProperty, getPlayerCredits as getPlayerCreditsFromDb, updatePlayerCredits, getPlayerProperties, seedProperties, getPlayerTotalRevenue } from '../db';
import { startJob, getActiveJob, cancelJob, checkObjective, tickWaitProgress, checkTimeExpired, getRemainingTime, getJobBoard, getActiveJobPlayerIds } from '../systems/jobs';
import { startTutorialIfNeeded, cancelTutorial } from '../systems/tutorial';

export class GameRoom extends Room<GameState> {
  maxClients = 50;

  /** Latest input per player, consumed each server tick. */
  private pendingInputs = new Map<string, PlayerInput>();

  /** Accumulated time (ms) since last revenue tick. */
  private lastRevenueTick = 0;

  onCreate() {
    this.setState(new GameState());
    this.setSimulationInterval((deltaTime) => this.update(deltaTime), 1000 / TICK_RATE);

    // Seed purchasable properties into DB if empty (12 per district, 60 total)
    const districts = [
      { name: 'Downtown', plots: 12, minPrice: 3000, maxPrice: 15000 },
      { name: 'Residential', plots: 12, minPrice: 1000, maxPrice: 5000 },
      { name: 'Industrial', plots: 12, minPrice: 1000, maxPrice: 8000 },
      { name: 'Waterfront', plots: 12, minPrice: 3000, maxPrice: 15000 },
      { name: 'Entertainment', plots: 12, minPrice: 500, maxPrice: 10000 },
    ];
    const seedBuildings: Array<{ name: string; district: string; price: number; revenue_rate: number }> = [];
    for (const d of districts) {
      for (let i = 1; i <= d.plots; i++) {
        const price = Math.round(d.minPrice + (d.maxPrice - d.minPrice) * (i / d.plots));
        const revenue_rate = Math.round(price * 0.02); // 2% of purchase price per tick
        seedBuildings.push({ name: `${d.name} Plot ${i}`, district: d.name, price, revenue_rate });
      }
    }
    seedProperties(seedBuildings);

    this.onMessage(MessageType.PLAYER_INPUT, (client: Client, input: PlayerInput) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      // Validate that all input fields are booleans
      if (
        typeof input.forward !== 'boolean' ||
        typeof input.backward !== 'boolean' ||
        typeof input.left !== 'boolean' ||
        typeof input.right !== 'boolean' ||
        typeof input.jump !== 'boolean'
      ) {
        return; // reject garbage input
      }

      // Store latest input — applied in update() with real delta time.
      // Clear when no movement requested so update() doesn't keep moving the player.
      if (input.forward || input.backward || input.left || input.right) {
        this.pendingInputs.set(client.sessionId, input);
      } else {
        this.pendingInputs.delete(client.sessionId);
      }
    });

    this.onMessage(MessageType.CHAT, (client: Client, message: { text: string }) => {
      if (typeof message.text !== 'string') return;

      const text = message.text.trim().slice(0, 200);
      if (text.length === 0) return;

      const player = this.state.players.get(client.sessionId);
      const senderName = player?.name ?? 'Unknown';

      this.broadcast(MessageType.CHAT, {
        senderId: client.sessionId,
        senderName,
        text,
      });
    });

    this.onMessage(MessageType.BUY_PROPERTY, (client: Client, data: { propertyId: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (typeof data.propertyId !== 'number') return;

      const success = purchaseProperty(data.propertyId, client.sessionId);
      if (success) {
        // Reload credits from DB and sync to Colyseus state
        player.credits = getPlayerCreditsFromDb(client.sessionId);
        client.send(MessageType.CREDITS_UPDATE, { credits: player.credits });
        // Broadcast property ownership change to all clients
        this.broadcast(MessageType.PROPERTY_UPDATE, {
          propertyId: data.propertyId,
          ownerId: client.sessionId,
          ownerName: player.name,
        });
        console.log(`${player.name} purchased property #${data.propertyId}`);
      } else {
        client.send(MessageType.CREDITS_UPDATE, { credits: player.credits, error: 'Purchase failed' });
      }
    });

    this.onMessage(MessageType.PLAYER_COLOR, (client: Client, data: { color: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (typeof data.color !== 'string') return;
      player.color = data.color;
    });

    this.onMessage(MessageType.FAST_TRAVEL, (client: Client, data: { stopIndex: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const stop = BUS_STOPS[data.stopIndex];
      if (!stop) return;
      player.x = stop.x;
      player.z = stop.z;
    });

    // ---- Job system handlers ----

    this.onMessage(MessageType.JOB_BOARD, (client: Client) => {
      client.send(MessageType.JOB_BOARD, { jobs: getJobBoard() });
    });

    this.onMessage(MessageType.JOB_START, (client: Client, data: { jobType: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (typeof data.jobType !== 'string') return;

      const job = startJob(client.sessionId, data.jobType);
      if (!job) {
        client.send(MessageType.JOB_START, { error: 'Cannot start job (cooldown or invalid type)' });
        return;
      }

      client.send(MessageType.JOB_START, {
        jobType: job.jobType,
        objectives: job.objectives.map(o => ({ type: o.type, x: o.x, z: o.z, radius: o.radius, duration: o.duration, completed: o.completed })),
        timeLimit: job.timeLimit,
        currentObjective: job.currentObjective,
      });
      console.log(`${player.name} started job: ${job.jobType}`);
    });

    console.log(`GameRoom created: ${this.roomId}`);
  }

  onJoin(client: Client, options: { name?: string }) {
    const displayName = options.name || `Player_${client.sessionId.slice(0, 4)}`;
    const row = getOrCreatePlayer(client.sessionId, displayName);

    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = row.name;
    player.x = row.x;
    player.y = row.y;
    player.z = row.z;
    player.credits = row.credits;
    player.color = '#3366cc';
    player.rotation = 0;

    this.state.players.set(client.sessionId, player);

    // Send initial credits so client UI can display them immediately
    client.send(MessageType.CREDITS_UPDATE, { credits: player.credits });

    // Start tutorial for new players
    startTutorialIfNeeded(client.sessionId, client);

    console.log(`${player.name} joined (${client.sessionId}) — credits: ${player.credits}`);
  }

  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      savePlayerPosition(client.sessionId, player.x, player.y, player.z);
      console.log(`${player.name} left (${client.sessionId}) — position saved`);
    }
    this.state.players.delete(client.sessionId);
    this.pendingInputs.delete(client.sessionId);
    cancelJob(client.sessionId);
    cancelTutorial(client.sessionId);
  }

  update(deltaTime: number) {
    // deltaTime is in milliseconds from Colyseus simulation interval
    const dt = deltaTime / 1000; // convert to seconds

    this.pendingInputs.forEach((input, sessionId) => {
      const player = this.state.players.get(sessionId);
      if (!player) return;

      const speed = PLAYER_SPEED * dt;

      if (input.forward) player.z -= speed;
      if (input.backward) player.z += speed;
      if (input.left) player.x -= speed;
      if (input.right) player.x += speed;

      // Sync rotation from client input
      player.rotation = input.rotation ?? player.rotation;

      // Clamp positions to world bounds
      player.x = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, player.x));
      player.z = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, player.z));
    });

    // ---- Passive revenue tick (every 60 seconds) ----
    this.lastRevenueTick += deltaTime;
    if (this.lastRevenueTick >= 60000) {
      this.lastRevenueTick = 0;
      this.state.players.forEach((player, sessionId) => {
        const revenue = getPlayerTotalRevenue(sessionId);
        if (revenue > 0) {
          const newCredits = player.credits + revenue;
          updatePlayerCredits(sessionId, newCredits);
          player.credits = newCredits;
          const client = this.clients.find(c => c.sessionId === sessionId);
          if (client) {
            client.send(MessageType.CREDITS_UPDATE, { credits: player.credits });
          }
          console.log(`${player.name} earned ${revenue} passive revenue (total: ${player.credits})`);
        }
      });
    }

    // ---- Job system tick ----
    for (const playerId of getActiveJobPlayerIds()) {
      const player = this.state.players.get(playerId);
      if (!player) continue;

      const client = this.clients.find(c => c.sessionId === playerId);
      if (!client) continue;

      // Check time expiry first
      if (checkTimeExpired(playerId)) {
        client.send(MessageType.JOB_COMPLETE, { success: false, reason: 'Time expired', reward: 0 });
        continue;
      }

      const job = getActiveJob(playerId);
      if (!job) continue;

      // Shop assistant wait-progress tick
      if (job.jobType === 'shop_assistant') {
        const waitResult = tickWaitProgress(playerId, player.x, player.z, dt);
        if (waitResult) {
          if (waitResult.jobDone) {
            // Persist earnings
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
          // Send wait progress update
          client.send(MessageType.JOB_UPDATE, {
            currentObjective: job.currentObjective,
            waitProgress: job.waitProgress,
            remaining: getRemainingTime(playerId),
          });
        }
        continue;
      }

      // For goto/interact jobs — check if player reached current objective
      const result = checkObjective(playerId, player.x, player.z);
      if (result.jobDone) {
        // Persist earnings
        const newCredits = player.credits + result.reward;
        updatePlayerCredits(playerId, newCredits);
        player.credits = newCredits;
        client.send(MessageType.JOB_COMPLETE, { success: true, reward: result.reward });
        client.send(MessageType.CREDITS_UPDATE, { credits: player.credits });
      } else if (result.completed) {
        // Objective completed but job continues
        const updatedJob = getActiveJob(playerId);
        client.send(MessageType.JOB_UPDATE, {
          currentObjective: updatedJob?.currentObjective ?? 0,
          spotReward: result.reward,
          remaining: getRemainingTime(playerId),
        });
      } else {
        // Send periodic progress (only every ~1 sec to reduce bandwidth — check tick count)
        // For simplicity, send every tick; the client can throttle display updates
        client.send(MessageType.JOB_UPDATE, {
          currentObjective: job.currentObjective,
          remaining: getRemainingTime(playerId),
        });
      }
    }
  }

  onDispose() {
    console.log(`GameRoom disposed: ${this.roomId}`);
  }
}
