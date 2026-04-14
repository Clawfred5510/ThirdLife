import { Engine, Scene } from '@babylonjs/core';
import { MainScene } from './scenes/MainScene';
import { connect, onPlayerAdd, getSessionId } from '../network/Client';

export class Game {
  private engine: Engine;
  private scene: Scene | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
    });

    window.addEventListener('resize', () => {
      this.engine.resize();
    });
  }

  async start() {
    const mainScene = new MainScene(this.engine, this.canvas);
    this.scene = await mainScene.create();

    // Try to connect to server; if unavailable, spawn a local player for offline mode
    try {
      await connect(`Player_${Math.random().toString(36).slice(2, 6)}`);
    } catch (err) {
      console.warn('Server unavailable — running in offline mode. Movement and exploration still work!');
      // Spawn a local-only player so the game is playable without a server
      const localId = 'local_offline_' + Math.random().toString(36).slice(2, 6);
      // Trigger the onPlayerAdd listener that MainScene registered to create the local mesh + camera
      const listeners = (mainScene as any)._offlinePlayerSpawn;
      if (typeof listeners === 'function') {
        listeners(localId);
      }
    }

    this.engine.runRenderLoop(() => {
      if (this.scene) {
        this.scene.render();
      }
    });
  }

  dispose() {
    this.scene?.dispose();
    this.engine.dispose();
  }
}
