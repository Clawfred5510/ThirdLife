import {
  Scene,
  Engine,
  ArcRotateCamera,
  HemisphericLight,
  MeshBuilder,
  Vector3,
  Color3,
  StandardMaterial,
  AbstractMesh,
} from '@babylonjs/core';
import {
  onPlayerAdd,
  onPlayerRemove,
  onPlayerChange,
  sendInput,
  getSessionId,
  PlayerSnapshot,
} from '../../network/Client';
import { PlayerInput } from '@gamestu/shared';

/** Per-player rendering data kept on the client. */
interface RemotePlayer {
  mesh: AbstractMesh;
  /** Latest server-authoritative position — interpolated towards each frame. */
  targetX: number;
  targetY: number;
  targetZ: number;
}

/** How quickly remote meshes interpolate toward their target (0-1, applied per-frame). */
const LERP_FACTOR = 0.2;

export class MainScene {
  /** Remote player meshes keyed by Colyseus sessionId. */
  private remotePlayers = new Map<string, RemotePlayer>();

  /** Current keyboard state. */
  private keys: Record<string, boolean> = {};

  /** Whether we were sending movement input last frame — used to send a stop signal. */
  private wasMoving = false;

  constructor(
    private engine: Engine,
    private canvas: HTMLCanvasElement,
  ) {}

  async create(): Promise<Scene> {
    const scene = new Scene(this.engine);
    scene.clearColor = new (Color3 as any)(0.53, 0.81, 0.92).toColor4(1);

    // Camera
    const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 30, Vector3.Zero(), scene);
    camera.attachControl(this.canvas, true);
    camera.lowerRadiusLimit = 5;
    camera.upperRadiusLimit = 100;

    // Lighting
    const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene);
    light.intensity = 0.9;

    // Ground
    const ground = MeshBuilder.CreateGround('ground', { width: 100, height: 100, subdivisions: 4 }, scene);
    const groundMat = new StandardMaterial('groundMat', scene);
    groundMat.diffuseColor = new Color3(0.4, 0.6, 0.3);
    ground.material = groundMat;

    // ---- Network listeners ----

    onPlayerAdd((sessionId: string, player: PlayerSnapshot) => {
      this.addRemotePlayer(sessionId, player, scene);
    });

    onPlayerRemove((sessionId: string) => {
      this.removeRemotePlayer(sessionId);
    });

    onPlayerChange((sessionId: string, player: PlayerSnapshot) => {
      this.updateRemotePlayerTarget(sessionId, player);
    });

    // ---- Keyboard input ----

    this.setupKeyboardInput();

    // ---- Per-frame update ----

    scene.onBeforeRenderObservable.add(() => {
      this.sendPlayerInput();
      this.interpolateRemotePlayers();
    });

    return scene;
  }

  // ---------- Remote player management ----------

  private addRemotePlayer(sessionId: string, player: PlayerSnapshot, scene: Scene): void {
    const isLocal = sessionId === getSessionId();
    const mesh = MeshBuilder.CreateBox(`player_${sessionId}`, { size: 1, height: 2 }, scene);
    mesh.position.set(player.x, player.y + 1, player.z);

    const mat = new StandardMaterial(`playerMat_${sessionId}`, scene);
    mat.diffuseColor = isLocal ? new Color3(0.2, 0.4, 0.8) : new Color3(0.8, 0.3, 0.2);
    mesh.material = mat;

    this.remotePlayers.set(sessionId, {
      mesh,
      targetX: player.x,
      targetY: player.y,
      targetZ: player.z,
    });
  }

  private removeRemotePlayer(sessionId: string): void {
    const remote = this.remotePlayers.get(sessionId);
    if (remote) {
      remote.mesh.dispose();
      this.remotePlayers.delete(sessionId);
    }
  }

  private updateRemotePlayerTarget(sessionId: string, player: PlayerSnapshot): void {
    const remote = this.remotePlayers.get(sessionId);
    if (remote) {
      remote.targetX = player.x;
      remote.targetY = player.y;
      remote.targetZ = player.z;
    }
  }

  private interpolateRemotePlayers(): void {
    this.remotePlayers.forEach((remote) => {
      const pos = remote.mesh.position;
      pos.x += (remote.targetX - pos.x) * LERP_FACTOR;
      pos.y += (remote.targetY + 1 - pos.y) * LERP_FACTOR; // +1 for half-height offset
      pos.z += (remote.targetZ - pos.z) * LERP_FACTOR;
    });
  }

  // ---------- Keyboard ----------

  private setupKeyboardInput(): void {
    const onKey = (e: KeyboardEvent, down: boolean) => {
      this.keys[e.code] = down;
    };
    window.addEventListener('keydown', (e) => onKey(e, true));
    window.addEventListener('keyup', (e) => onKey(e, false));
  }

  private sendPlayerInput(): void {
    const input: PlayerInput = {
      forward: !!this.keys['KeyW'] || !!this.keys['ArrowUp'],
      backward: !!this.keys['KeyS'] || !!this.keys['ArrowDown'],
      left: !!this.keys['KeyA'] || !!this.keys['ArrowLeft'],
      right: !!this.keys['KeyD'] || !!this.keys['ArrowRight'],
      jump: !!this.keys['Space'],
    };

    const isMoving = input.forward || input.backward || input.left || input.right || input.jump;

    // Send when moving, or once when stopping (so server clears the pending input)
    if (isMoving || this.wasMoving) {
      sendInput(input);
    }
    this.wasMoving = isMoving;
  }
}
