import { Room, Client } from 'colyseus';
import { GameState, PlayerState } from '../state/GameState';
import { TICK_RATE, PLAYER_SPEED, WORLD_HALF, MessageType, PlayerInput } from '@gamestu/shared';
import { getOrCreatePlayer, savePlayerPosition, purchaseProperty, getPlayerCredits as getPlayerCreditsFromDb, getPlayerProperties } from '../db';

export class GameRoom extends Room<GameState> {
  maxClients = 50;

  /** Latest input per player, consumed each server tick. */
  private pendingInputs = new Map<string, PlayerInput>();

  onCreate() {
    this.setState(new GameState());
    this.setSimulationInterval((deltaTime) => this.update(deltaTime), 1000 / TICK_RATE);

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

    this.state.players.set(client.sessionId, player);
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

    // Future: physics, NPC AI, economy ticks
  }

  onDispose() {
    console.log(`GameRoom disposed: ${this.roomId}`);
  }
}
