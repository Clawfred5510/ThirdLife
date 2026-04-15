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
  ActionManager,
  ExecuteCodeAction,
} from '@babylonjs/core';
import { AdvancedDynamicTexture, Rectangle, TextBlock } from '@babylonjs/gui';
import {
  onPlayerAdd,
  onPlayerRemove,
  onPlayerChange,
  sendInput,
  getSessionId,
  PlayerSnapshot,
  onParcelUpdate,
} from '../../network/Client';
import { PlayerInput, TICK_RATE, PLAYER_SPEED, features, ParcelData } from '@gamestu/shared';
import { DayNightCycle } from '../systems/dayNight';
import { spawnBuildings, ALL_PARCELS, ParcelDef } from '../entities/buildings';
import { spawnNPCs } from '../entities/npcs';
import { selectParcel } from '../../ui/components/ParcelPanel';

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

/** Per-parcel rendering data. */
interface ParcelRenderData {
  /** The ground tile mesh (always present). */
  ground: AbstractMesh;
  /** The business box mesh (only when owned). */
  box: AbstractMesh | null;
  /** Floating business name label (only when owned with a name). */
  label: Rectangle | null;
}

export class MainScene {
  /** Remote player meshes keyed by Colyseus sessionId. */
  private remotePlayers = new Map<string, RemotePlayer>();

  /** Parcel rendering data keyed by parcel ID. */
  private parcelRenders = new Map<number, ParcelRenderData>();

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

  /** Lookup from world position to parcel ID. */
  private parcelByDef = new Map<string, number>();

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

    // ---- Uniform parcel grid (replaces legacy districts, river, bay, boulevards) ----
    this.spawnBuildingsAndSetupParcels(scene);

    // ---- Day/Night Cycle ----
    if (features.DAY_NIGHT) {
      this.dayNight = new DayNightCycle(scene, { cycleDurationSeconds: 600 });
      activeDayNight = this.dayNight;
    }

    // Fullscreen GUI layer for floating player name labels
    this.labelUI = AdvancedDynamicTexture.CreateFullscreenUI('playerLabelsUI', true, scene);

    // ---- NPCs ----
    if (features.NPCS) {
      spawnNPCs(scene, this.labelUI);
    }

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

    // ---- Parcel update listener (from Colyseus schema sync + broadcast messages) ----
    onParcelUpdate((update: Partial<ParcelData> & { owner_name?: string; error?: string }) => {
      if (update.id === undefined) return;
      this.handleParcelUpdate(update.id, update);
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
      if (this.dayNight) {
        this.dayNight.update(this.engine.getDeltaTime() / 1000);
      }
    });

    return scene;
  }

  // ---------- Parcel system ----------

  private spawnBuildingsAndSetupParcels(scene: Scene): void {
    // Build a lookup map from world position to parcel ID
    for (const p of ALL_PARCELS) {
      this.parcelByDef.set(`${p.x},${p.z}`, p.id);
    }

    const meshes = spawnBuildings(scene);

    // Register each parcel ground tile for pointer picking
    for (const mesh of meshes) {
      if (mesh.name.startsWith('lot_') && mesh.metadata?.parcelId !== undefined) {
        const parcelId = mesh.metadata.parcelId as number;
        this.parcelRenders.set(parcelId, {
          ground: mesh,
          box: null,
          label: null,
        });

        // Set up click action on each parcel ground tile
        mesh.actionManager = new ActionManager(scene);
        mesh.actionManager.registerAction(
          new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
            this.onParcelClicked(parcelId);
          }),
        );
      }
    }
  }

  private onParcelClicked(parcelId: number): void {
    const renderData = this.parcelRenders.get(parcelId);
    if (!renderData) return;

    const def = ALL_PARCELS.find((p) => p.id === parcelId);
    if (!def) return;

    // Get the current state from the render data (box presence indicates owned)
    const parcelInfo: ParcelData = {
      id: parcelId,
      grid_x: def.grid_x,
      grid_y: def.grid_y,
      owner_id: '',
      business_name: '',
      business_type: '',
      color: '#4a90d9',
      height: 4,
    };

    // Check if there's a box (business) on this parcel — the box stores metadata
    if (renderData.box) {
      const meta = renderData.box.metadata;
      parcelInfo.owner_id = meta?.owner_id ?? '';
      parcelInfo.business_name = meta?.business_name ?? '';
      parcelInfo.business_type = meta?.business_type ?? '';
      parcelInfo.color = meta?.color ?? '#4a90d9';
      parcelInfo.height = meta?.height ?? 4;
    }

    selectParcel(parcelInfo);
  }

  private handleParcelUpdate(parcelId: number, data: Partial<ParcelData>): void {
    const renderData = this.parcelRenders.get(parcelId);
    if (!renderData || !this.sceneRef) return;

    const def = ALL_PARCELS.find((p) => p.id === parcelId);
    if (!def) return;

    // If owner_id is empty string or undefined, remove the business
    const ownerId = data.owner_id ?? '';
    if (ownerId === '') {
      this.removeBusinessFromParcel(renderData);
      return;
    }

    // Update or create the business box
    this.updateOrCreateBusinessBox(renderData, def, data);
  }

  private updateOrCreateBusinessBox(
    renderData: ParcelRenderData,
    def: ParcelDef,
    data: Partial<ParcelData>,
  ): void {
    const scene = this.sceneRef!;

    if (!renderData.box) {
      // Create new business box
      const height = data.height ?? 4;
      const box = MeshBuilder.CreateBox(`bizBox_${def.id}`, {
        width: 14,
        height: Math.max(0.5, height),
        depth: 14,
      }, scene);
      box.position.set(def.x, Math.max(0.5, height) / 2, def.z);

      const mat = new StandardMaterial(`bizMat_${def.id}`, scene);
      mat.diffuseColor = hexToColor3(data.color ?? '#4a90d9');
      box.material = mat;

      box.isPickable = true;
      box.metadata = {
        parcelId: def.id,
        owner_id: data.owner_id ?? '',
        business_name: data.business_name ?? '',
        business_type: data.business_type ?? '',
        color: data.color ?? '#4a90d9',
        height: height,
      };

      // Click action on the business box too
      box.actionManager = new ActionManager(scene);
      box.actionManager.registerAction(
        new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
          this.onParcelClicked(def.id);
        }),
      );

      renderData.box = box;

      // Create floating label if there's a business name
      if (data.business_name && data.business_name.trim() !== '') {
        const labelRect = new Rectangle(`bizLabel_${def.id}`);
        labelRect.width = '140px';
        labelRect.height = '28px';
        labelRect.cornerRadius = 4;
        labelRect.color = 'transparent';
        labelRect.background = 'rgba(0,0,0,0.55)';
        labelRect.thickness = 0;

        const labelText = new TextBlock(`bizLabelText_${def.id}`, data.business_name);
        labelText.color = 'white';
        labelText.fontSize = 12;
        labelText.resizeToFit = true;
        labelRect.addControl(labelText);

        this.labelUI.addControl(labelRect);
        labelRect.linkWithMesh(box);
        labelRect.linkOffsetY = -40;

        renderData.label = labelRect;
      }
    } else {
      // Update existing box
      const box = renderData.box;
      const newHeight = data.height ?? Number(box.metadata?.height ?? 4);
      const newColor = data.color ?? box.metadata?.color ?? '#4a90d9';

      // Update height
      if (data.height !== undefined) {
        box.scaling.y = Math.max(0.5, newHeight) / Math.max(0.5, Number(box.metadata?.height ?? 4));
        box.position.y = Math.max(0.5, newHeight) / 2;
      }

      // Update color
      if (data.color !== undefined) {
        const mat = box.material as StandardMaterial;
        if (mat) {
          mat.diffuseColor = hexToColor3(newColor);
        }
      }

      // Update metadata
      box.metadata = {
        ...box.metadata,
        owner_id: data.owner_id ?? box.metadata?.owner_id ?? '',
        business_name: data.business_name ?? box.metadata?.business_name ?? '',
        business_type: data.business_type ?? box.metadata?.business_type ?? '',
        color: newColor,
        height: newHeight,
      };

      // Update label
      if (data.business_name !== undefined) {
        const name = data.business_name.trim();
        if (name === '' && renderData.label) {
          renderData.label.dispose();
          renderData.label = null;
        } else if (name !== '') {
          if (renderData.label) {
            // Update existing label text
            const textBlock = renderData.label.children?.[0] as TextBlock | undefined;
            if (textBlock) textBlock.text = name;
          } else {
            // Create new label
            const labelRect = new Rectangle(`bizLabel_${def.id}`);
            labelRect.width = '140px';
            labelRect.height = '28px';
            labelRect.cornerRadius = 4;
            labelRect.color = 'transparent';
            labelRect.background = 'rgba(0,0,0,0.55)';
            labelRect.thickness = 0;

            const labelText = new TextBlock(`bizLabelText_${def.id}`, name);
            labelText.color = 'white';
            labelText.fontSize = 12;
            labelText.resizeToFit = true;
            labelRect.addControl(labelText);

            this.labelUI.addControl(labelRect);
            labelRect.linkWithMesh(box);
            labelRect.linkOffsetY = -40;

            renderData.label = labelRect;
          }
        }
      }
    }
  }

  private removeBusinessFromParcel(renderData: ParcelRenderData): void {
    if (renderData.box) {
      renderData.box.dispose();
      renderData.box = null;
    }
    if (renderData.label) {
      renderData.label.dispose();
      renderData.label = null;
    }
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
