import { Engine, Scene } from '@babylonjs/core';
import { MainScene } from './scenes/MainScene';
import { connect } from '../network/Client';

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

    // Connect to server after the scene is ready so onPlayerAdd listeners are registered
    try {
      await connect(`Player_${Math.random().toString(36).slice(2, 6)}`);
    } catch (err) {
      console.error('Failed to connect to server:', err);
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
