import {
  Scene,
  Engine,
  ArcRotateCamera,
  FollowCamera,
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
import { DayNightCycle } from '../systems/dayNight';
import { spawnBuildings } from '../entities/buildings';
import { spawnNPCs } from '../entities/npcs';

/** Module-level reference to the active DayNightCycle for external access. */
let activeDayNight: DayNightCycle | null = null;

/** Get the active day/night cycle system (if the scene has been created). */
export function getDayNightCycle(): DayNightCycle | null {
  return activeDayNight;
}

/** Convert a hex color string (e.g. '#3366cc') to a Babylon Color3. */
const hexToColor3 = (hex: string): Color3 => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return new Color3(r, g, b);
};

/** Per-player rendering data kept on the client. */
interface RemotePlayer {
  mesh: AbstractMesh;
  /** Floating name label linked to the mesh. */
  label: Rectangle;
  /** Latest server-authoritative position — interpolated towards each frame. */
  targetX: number;
  targetY: number;
  targetZ: number;
  /** Last known color hex, used to detect changes. */
  currentColor: string;
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

  /** Day/night cycle system. */
  private dayNight!: DayNightCycle;

  /** Timestamp of the last input sent to the server (for throttling). */
  private lastInputTime = 0;

  /** Reference to the initial ArcRotateCamera so it can be disposed when follow camera activates. */
  private arcCamera: ArcRotateCamera | null = null;

  /** Scene reference for creating follow camera later. */
  private sceneRef: Scene | null = null;

  /** Session ID of the local player — set from Colyseus when online, or from offline spawn. */
  private localPlayerId: string | null = null;

  constructor(
    private engine: Engine,
    private canvas: HTMLCanvasElement,
  ) {}

  async create(): Promise<Scene> {
    const scene = new Scene(this.engine);
    scene.clearColor = new Color4(0.53, 0.81, 0.92, 1);

    // Camera — start with ArcRotateCamera; replaced by FollowCamera once local player spawns
    const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 30, Vector3.Zero(), scene);
    camera.attachControl(this.canvas, true);
    scene.activeCamera = camera;
    camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
    camera.lowerRadiusLimit = 5;
    camera.upperRadiusLimit = 100;
    this.arcCamera = camera;
    this.sceneRef = scene;

    // Lighting
    const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene);
    light.intensity = 0.9;

    // ---- Base ground (dark green/brown for parks & buffers) ----
    const baseGround = MeshBuilder.CreateGround('baseGround', { width: 2000, height: 2000, subdivisions: 8 }, scene);
    const baseGroundMat = new StandardMaterial('baseGroundMat', scene);
    baseGroundMat.diffuseColor = new Color3(0.3, 0.42, 0.25);
    baseGround.material = baseGroundMat;

    // ---- District ground planes (Y=0.01) ----
    // Coordinate mapping: design (x,y) → babylon (x-1000, y-1000)
    const districts: { name: string; x1: number; y1: number; x2: number; y2: number; color: [number, number, number] }[] = [
      { name: 'Downtown',      x1: 1100, y1: 400,  x2: 1800, y2: 1100, color: [0.6, 0.65, 0.7] },
      { name: 'Residential',   x1: 100,  y1: 1100, x2: 900,  y2: 1900, color: [0.45, 0.65, 0.35] },
      { name: 'Industrial',    x1: 1100, y1: 1200, x2: 1900, y2: 1900, color: [0.5, 0.5, 0.48] },
      { name: 'Waterfront',    x1: 1200, y1: 0,    x2: 2000, y2: 500,  color: [0.76, 0.7, 0.55] },
      { name: 'Entertainment', x1: 100,  y1: 400,  x2: 900,  y2: 1100, color: [0.55, 0.45, 0.6] },
    ];

    for (const d of districts) {
      const w = d.x2 - d.x1;
      const h = d.y2 - d.y1;
      const cx = (d.x1 + d.x2) / 2 - 1000;
      const cz = (d.y1 + d.y2) / 2 - 1000;

      const mesh = MeshBuilder.CreateGround(`district_${d.name}`, { width: w, height: h }, scene);
      mesh.position.set(cx, 0.01, cz);
      const mat = new StandardMaterial(`districtMat_${d.name}`, scene);
      mat.diffuseColor = new Color3(d.color[0], d.color[1], d.color[2]);
      mesh.material = mat;
    }

    // ---- Roads (Y=0.05, dark gray) ----
    const roadColor = new Color3(0.25, 0.25, 0.25);

    const roads: { name: string; cx: number; cz: number; w: number; h: number }[] = [
      // Haven Boulevard: east-west at z=0, full width, width 30
      { name: 'HavenBlvd',   cx: 0,    cz: 0,    w: 2000, h: 30 },
      // Central Avenue: north-south at x=0, full height, width 30
      { name: 'CentralAve',  cx: 0,    cz: 0,    w: 30,   h: 2000 },
      // Bayshore Drive: east-west at z=-800, from x=-1000 to x=800, width 20
      { name: 'BayshoreDr',  cx: -100, cz: -800, w: 1800, h: 20 },
      // Ring Road: east-west at z=500, from x=-500 to x=500, width 20
      { name: 'RingRoad',    cx: 0,    cz: 500,  w: 1000, h: 20 },
    ];

    for (const r of roads) {
      const mesh = MeshBuilder.CreateGround(`road_${r.name}`, { width: r.w, height: r.h }, scene);
      mesh.position.set(r.cx, 0.05, r.cz);
      const mat = new StandardMaterial(`roadMat_${r.name}`, scene);
      mat.diffuseColor = roadColor;
      mesh.material = mat;
    }

    // ---- River (Y=-0.1, blue, diagonal from southwest to center) ----
    // Runs roughly from (-1000, 0) to (200, -1000) — use a rotated strip
    const waterColor = new Color3(0.2, 0.4, 0.7);

    const riverLength = Math.sqrt(1200 * 1200 + 1000 * 1000); // ~1562
    const riverMesh = MeshBuilder.CreateGround('river', { width: 100, height: riverLength }, scene);
    riverMesh.position.set(-400, -0.1, -500); // midpoint of the line
    riverMesh.rotation.y = Math.atan2(1200, 1000); // angle from (−1000,0)→(200,−1000)
    const riverMat = new StandardMaterial('riverMat', scene);
    riverMat.diffuseColor = waterColor;
    riverMesh.material = riverMat;

    // ---- Bay (Y=-0.1, blue, southern area below z=-800 on the west side) ----
    // Covers roughly x: -1000 to 200, z: -1000 to -800
    const bayMesh = MeshBuilder.CreateGround('bay', { width: 1200, height: 200 }, scene);
    bayMesh.position.set(-400, -0.1, -900);
    const bayMat = new StandardMaterial('bayMat', scene);
    bayMat.diffuseColor = waterColor;
    bayMesh.material = bayMat;

    // ---- Buildings & Landmarks ----
    spawnBuildings(scene);

    // ---- Day/Night Cycle ----
    this.dayNight = new DayNightCycle(scene, { cycleDurationSeconds: 600 });
    activeDayNight = this.dayNight;

    // Fullscreen GUI layer for floating player name labels
    this.labelUI = AdvancedDynamicTexture.CreateFullscreenUI('playerLabelsUI', true, scene);

    // ---- NPCs ----
    spawnNPCs(scene, this.labelUI);

    // ---- Network listeners ----

    onPlayerAdd((sessionId: string, player: PlayerSnapshot) => {
      // Track the local player ID so offline movement logic works even online
      if (sessionId === getSessionId()) {
        this.localPlayerId = sessionId;
      }
      this.addRemotePlayer(sessionId, player, scene);
    });

    onPlayerRemove((sessionId: string) => {
      this.removeRemotePlayer(sessionId);
    });

    onPlayerChange((sessionId: string, player: PlayerSnapshot) => {
      this.updateRemotePlayerTarget(sessionId, player);
    });

    // Expose offline spawn method for when server is unavailable
    (this as any)._offlinePlayerSpawn = (localId: string) => {
      this.localPlayerId = localId;
      this.addRemotePlayer(localId, {
        id: localId,
        name: 'You (Offline)',
        x: 0,
        y: 0,
        z: 0,
        rotation: 0,
        color: '#3366cc',
      }, scene);
    };

    // ---- Keyboard input ----

    this.setupKeyboardInput();

    // ---- Per-frame update ----

    scene.onBeforeRenderObservable.add(() => {
      this.sendPlayerInput();
      this.applyLocalPrediction();
      this.interpolateRemotePlayers();
      this.dayNight.update(this.engine.getDeltaTime() / 1000);
    });

    return scene;
  }

  // ---------- Remote player management ----------

  private addRemotePlayer(sessionId: string, player: PlayerSnapshot, scene: Scene): void {
    const isLocal = sessionId === getSessionId() || sessionId === this.localPlayerId;

    // Capsule body + sphere head for a humanoid silhouette
    const mesh = MeshBuilder.CreateCapsule(`player_${sessionId}`, {
      height: 1.8,
      radius: 0.3,
      tessellation: 12,
      subdivisions: 1,
    }, scene);
    mesh.position.set(player.x, player.y + 0.9, player.z);

    const mat = new StandardMaterial(`playerMat_${sessionId}`, scene);
    const playerColor = player.color || (isLocal ? '#3366cc' : '#cc4d33');
    mat.diffuseColor = hexToColor3(playerColor);
    mesh.material = mat;

    // Head sphere parented to body
    const head = MeshBuilder.CreateSphere(`head_${sessionId}`, { diameter: 0.4, segments: 8 }, scene);
    head.parent = mesh;
    head.position.y = 0.65; // relative to capsule center
    const headMat = new StandardMaterial(`headMat_${sessionId}`, scene);
    headMat.diffuseColor = hexToColor3(playerColor);
    head.material = headMat;

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
    labelRect.linkOffsetY = -110;

    this.remotePlayers.set(sessionId, {
      mesh,
      label: labelRect,
      targetX: player.x,
      targetY: player.y,
      targetZ: player.z,
      currentColor: playerColor,
    });

    // Switch to third-person FollowCamera when the local player mesh is ready
    if (isLocal && this.sceneRef) {
      const followCam = new FollowCamera('followCamera', new Vector3(player.x, player.y + 15, player.z + 15), this.sceneRef);
      followCam.lockedTarget = mesh;
      followCam.radius = 15;
      followCam.heightOffset = 8;
      followCam.rotationOffset = 180;
      followCam.cameraAcceleration = 0.05;
      followCam.maxCameraSpeed = 10;
      followCam.inputs.removeByType('FollowCameraKeyboardMoveInput');

      this.sceneRef.activeCamera = followCam;

      // Dispose the initial ArcRotateCamera
      if (this.arcCamera) {
        this.arcCamera.detachControl();
        this.arcCamera.dispose();
        this.arcCamera = null;
      }
    }
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

      // Update mesh color if it changed
      if (player.color && player.color !== remote.currentColor) {
        const mat = remote.mesh.material as StandardMaterial;
        if (mat) {
          mat.diffuseColor = hexToColor3(player.color);
        }
        remote.currentColor = player.color;
      }

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
    // Use Colyseus sessionId when online, fall back to offline player ID
    const localId = getSessionId() ?? this.localPlayerId;
    if (!localId) return;

    const remote = this.remotePlayers.get(localId);
    if (!remote) return;

    const dt = this.engine.getDeltaTime() / 1000; // seconds
    const speed = PLAYER_SPEED * dt;

    let dx = 0;
    let dz = 0;

    if (this.keys['KeyW'] || this.keys['ArrowUp']) dz -= speed;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) dz += speed;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) dx -= speed;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) dx += speed;

    if (dx !== 0 || dz !== 0) {
      remote.mesh.position.x += dx;
      remote.mesh.position.z += dz;
    }
  }

  private interpolateRemotePlayers(): void {
    const localId = getSessionId() ?? this.localPlayerId;
    this.remotePlayers.forEach((remote, sessionId) => {
      // Skip the local player — their position is handled by applyLocalPrediction()
      if (sessionId === localId) return;

      const pos = remote.mesh.position;
      pos.x += (remote.targetX - pos.x) * LERP_FACTOR;
      pos.y += (remote.targetY + 0.9 - pos.y) * LERP_FACTOR; // +0.9 for capsule half-height
      pos.z += (remote.targetZ - pos.z) * LERP_FACTOR;

      // Clamp Y to ground level (capsule half-height = 0.9) to prevent drift below terrain
      if (pos.y < 0.9) {
        pos.y = 0.9;
      }
    });
  }

  // ---------- Keyboard ----------

  private setupKeyboardInput(): void {
    const gameKeys = new Set([
      'KeyW', 'KeyA', 'KeyS', 'KeyD',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Space',
    ]);

    window.addEventListener('keydown', (e) => {
      if (gameKeys.has(e.code)) e.preventDefault();
      this.keys[e.code] = true;
    });

    window.addEventListener('keyup', (e) => {
      if (gameKeys.has(e.code)) e.preventDefault();
      this.keys[e.code] = false;
    });
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
