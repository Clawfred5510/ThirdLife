import { Room, Client } from 'colyseus';
import { GameState, PlayerState } from '../state/GameState';
import { TICK_RATE, PLAYER_SPEED, MessageType, PlayerInput } from '@gamestu/shared';

export class GameRoom extends Room<GameState> {
  maxClients = 50;

  onCreate() {
    this.setState(new GameState());
    this.setSimulationInterval((deltaTime) => this.update(deltaTime), 1000 / TICK_RATE);

    this.onMessage(MessageType.PLAYER_INPUT, (client: Client, input: PlayerInput) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const delta = (deltaTime: number) => PLAYER_SPEED * (deltaTime / 1000);
      const speed = delta(16); // ~60fps equivalent

      if (input.forward) player.z -= speed;
      if (input.backward) player.z += speed;
      if (input.left) player.x -= speed;
      if (input.right) player.x += speed;
    });

    this.onMessage(MessageType.CHAT, (client: Client, message: { text: string }) => {
      this.broadcast(MessageType.CHAT, {
        senderId: client.sessionId,
        text: message.text,
      });
    });

    console.log(`GameRoom created: ${this.roomId}`);
  }

  onJoin(client: Client, options: { name?: string }) {
    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = options.name || `Player_${client.sessionId.slice(0, 4)}`;
    player.x = Math.random() * 20 - 10;
    player.y = 0;
    player.z = Math.random() * 20 - 10;

    this.state.players.set(client.sessionId, player);
    console.log(`${player.name} joined (${client.sessionId})`);
  }

  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      console.log(`${player.name} left (${client.sessionId})`);
    }
    this.state.players.delete(client.sessionId);
  }

  update(_deltaTime: number) {
    // Future: physics, NPC AI, economy ticks
  }

  onDispose() {
    console.log(`GameRoom disposed: ${this.roomId}`);
  }
}
