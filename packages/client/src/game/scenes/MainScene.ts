import {
  Scene,
  Engine,
  ArcRotateCamera,
  HemisphericLight,
  MeshBuilder,
  Vector3,
  Color3,
  Color4,
  StandardMaterial,
  AbstractMesh,
} from '@babylonjs/core';
import { AdvancedDynamicTexture, Rectangle, TextBlock } from '@babylonjs/gui';
import {
  onPlayerAdd,
  onPlayerRemove,
  onPlayerChange,
  sendInput,
  getSessionId,
  PlayerSnapshot,
} from '../../network/Client';
import { PlayerInput, TICK_RATE, PLAYER_SPEED } from '@gamestu/shared';

/** Per-player rendering data kept on the client. */
interface RemotePlayer {
  mesh: AbstractMesh;
  /** Floating name label linked to the mesh. */
  label: Rectangle;
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

  /** Fullscreen GUI layer for player name labels. */
  private labelUI!: AdvancedDynamicTexture;

  /** Current keyboard state. */
  private keys: Record<string, boolean> = {};

  /** Whether we were sending movement input last frame — used to send a stop signal. */
  private wasMoving = false;

  /** Timestamp of the last input sent to the server (for throttling). */
  private lastInputTime = 0;

  constructor(
    private engine: Engine,
    private canvas: HTMLCanvasElement,
  ) {}

  async create(): Promise<Scene> {
    const scene = new Scene(this.engine);
    scene.clearColor = new Color4(0.53, 0.81, 0.92, 1);

    // Camera
    const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 30, Vector3.Zero(), scene);
    camera.attachControl(this.canvas, true);
    camera.lowerRadiusLimit = 5;
    camera.upperRadiusLimit = 100;

    // Lighting
    const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene);
    light.intensity = 0.9;

    // Ground — sized to match the 2000x2000 world
    const ground = MeshBuilder.CreateGround('ground', { width: 2000, height: 2000, subdivisions: 8 }, scene);
    const groundMat = new StandardMaterial('groundMat', scene);
    groundMat.diffuseColor = new Color3(0.4, 0.6, 0.3);
    ground.material = groundMat;

    // Fullscreen GUI layer for floating player name labels
    this.labelUI = AdvancedDynamicTexture.CreateFullscreenUI('playerLabelsUI', true, scene);

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
      this.applyLocalPrediction();
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

    // Floating name label
    const labelRect = new Rectangle(`label_${sessionId}`);
    labelRect.width = '100px';
    labelRect.height = '30px';
    labelRect.cornerRadius = 4;
    labelRect.color = 'transparent';
    labelRect.background = 'transparent';
    labelRect.thickness = 0;

    const labelText = new TextBlock(`labelText_${sessionId}`, player.name);
    labelText.color = 'white';
    labelText.fontSize = 14;
    labelText.resizeToFit = true;
    labelRect.addControl(labelText);

    this.labelUI.addControl(labelRect);
    labelRect.linkWithMesh(mesh);
    labelRect.linkOffsetY = -120;

    this.remotePlayers.set(sessionId, {
      mesh,
      label: labelRect,
      targetX: player.x,
      targetY: player.y,
      targetZ: player.z,
    });
  }

  private removeRemotePlayer(sessionId: string): void {
    const remote = this.remotePlayers.get(sessionId);
    if (remote) {
      remote.label.dispose();
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

      // For local player: snap to server position if prediction drifted too far
      if (sessionId === getSessionId()) {
        const dx = player.x - remote.mesh.position.x;
        const dz = player.z - remote.mesh.position.z;
        if (Math.sqrt(dx * dx + dz * dz) > 2) {
          remote.mesh.position.x = player.x;
          remote.mesh.position.z = player.z;
        }
      }
    }
  }

  /**
   * Apply immediate local movement to the local player's mesh so input feels
   * responsive without waiting for the server round-trip.
   */
  private applyLocalPrediction(): void {
    const localId = getSessionId();
    if (!localId) return;

    const remote = this.remotePlayers.get(localId);
    if (!remote) return;

    const dt = this.engine.getDeltaTime() / 1000; // seconds
    const speed = PLAYER_SPEED * dt;

    let dx = 0;
    let dz = 0;

    if (this.keys['KeyW'] || this.keys['ArrowUp']) dz += speed;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) dz -= speed;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) dx -= speed;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) dx += speed;

    if (dx !== 0 || dz !== 0) {
      remote.mesh.position.x += dx;
      remote.mesh.position.z += dz;
    }
  }

  private interpolateRemotePlayers(): void {
    this.remotePlayers.forEach((remote) => {
      const pos = remote.mesh.position;
      pos.x += (remote.targetX - pos.x) * LERP_FACTOR;
      pos.y += (remote.targetY + 1 - pos.y) * LERP_FACTOR; // +1 for half-height offset
      pos.z += (remote.targetZ - pos.z) * LERP_FACTOR;

      // Clamp Y to ground level (half-height = 1.0) to prevent drift below terrain
      if (pos.y < 1.0) {
        pos.y = 1.0;
      }
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
    const now = performance.now();
    const minInterval = 1000 / TICK_RATE; // 50ms at 20Hz

    // Always send stop signal immediately when player stops moving
    if (!isMoving && this.wasMoving) {
      sendInput(input);
      this.lastInputTime = now;
    } else if (isMoving && now - this.lastInputTime >= minInterval) {
      sendInput(input);
      this.lastInputTime = now;
    }

    this.wasMoving = isMoving;
  }
}
