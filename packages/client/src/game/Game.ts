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

    const resize = () => this.engine.resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    // visualViewport fires on iOS Safari URL-bar collapse/expand, which
    // doesn't always trigger a regular `resize` event. Without this the
    // canvas keeps its stale buffer size and renders into a scaled letterbox.
    window.visualViewport?.addEventListener('resize', resize);
  }

  async start() {
    const mainScene = new MainScene(this.engine, this.canvas);
    this.scene = await mainScene.create();

    try {
      await connect(`Player_${Math.random().toString(36).slice(2, 6)}`);
    } catch (err) {
      console.warn('Server unavailable — running in offline mode. Movement and exploration still work!');
      const localId = 'local_offline_' + Math.random().toString(36).slice(2, 6);
      mainScene.spawnOfflinePlayer(localId);
    }

    this.engine.runRenderLoop(() => {
      if (this.scene) {
        this.scene.render();
      }
    });

    // Resolve only once the scene has compiled its materials/shaders and is
    // ready to render. The wallet-gate loading screen awaits this so it never
    // hands off to a world that's still mid-compile (the "graphics look weird
    // from the start" the loading screen exists to hide). GLB buildings stream
    // in fire-and-forget after this; the loading screen's minimum-duration
    // floor covers their pop-in on a normal connection.
    await new Promise<void>((resolve) => {
      this.scene!.executeWhenReady(() => resolve());
    });
  }

  dispose() {
    this.scene?.dispose();
    this.engine.dispose();
  }
}
