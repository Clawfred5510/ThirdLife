import {
  Scene,
  Engine,
  ArcRotateCamera,
  FollowCamera,
  HemisphericLight,
  DirectionalLight,
  MeshBuilder,
  Vector3,
  Color3,
  Color4,
  StandardMaterial,
  AbstractMesh,
  Mesh,
  TransformNode,
  ActionManager,
  ExecuteCodeAction,
  DefaultRenderingPipeline,
  CubeTexture,
  ImageProcessingConfiguration,
  CascadedShadowGenerator,
  SceneLoader,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { Avatar, buildAvatar, applyAppearance, disposeAvatar, animateAvatar } from '../entities/avatar';
import { DEFAULT_APPEARANCE } from '@gamestu/shared';
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
import {
  PlayerInput,
  TICK_RATE,
  PLAYER_SPEED,
  SPRINT_MULTIPLIER,
  features,
  ParcelData,
  FOG_DENSITY,
  SKY_COLOR,
  CAMERA_INITIAL_MIN_ZOOM,
  CAMERA_INITIAL_MAX_ZOOM,
  CAMERA_FOLLOW_MIN_ZOOM,
  CAMERA_FOLLOW_MAX_ZOOM,
  DAY_CYCLE_SECONDS,
  REMOTE_PLAYER_LERP,
} from '@gamestu/shared';
import { DayNightCycle } from '../systems/dayNight';
import { spawnBuildings, ALL_PARCELS, ParcelDef, BUILDING_VARIANTS, instantiateBuilding } from '../entities/buildings';
import { spawnNPCs } from '../entities/npcs';
import { selectParcel } from '../../ui/components/ParcelPanel';

/** Module-level reference to the active DayNightCycle for external access. */
let activeDayNight: DayNightCycle | null = null;
/** Cascaded shadow generator — entity code registers meshes as casters. */
let activeShadowGenerator: CascadedShadowGenerator | null = null;

export function getDayNightCycle(): DayNightCycle | null {
  return activeDayNight;
}

/** Returns the scene's cascaded shadow generator, or null before scene create. */
export function getShadowGenerator(): CascadedShadowGenerator | null {
  return activeShadowGenerator;
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
  root: TransformNode;
  avatar: Avatar;
  label: Rectangle;
  targetX: number;
  targetY: number;
  targetZ: number;
  targetRotation: number;
  currentColor: string;
  appearanceKey: string;
  prevX: number;
  prevZ: number;
}

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

  /** Last yaw sent to the server — used to broadcast pure-rotation updates when idle. */
  private lastSentYaw = 0;

  /** Reference to the initial ArcRotateCamera so it can be disposed when follow camera activates. */
  private arcCamera: ArcRotateCamera | null = null;

  /** Scene reference for creating follow camera later. */
  private sceneRef: Scene | null = null;

  /** Session ID of the local player — set from Colyseus when online, or from offline spawn. */
  private localPlayerId: string | null = null;

  /** The local avatar's root TransformNode (world-space) — used by the camera tracker. */
  private localPlayerRoot: TransformNode | null = null;

  /** Lookup from world position to parcel ID. */
  private parcelByDef = new Map<string, number>();

  private cloudInstances: Array<{ node: TransformNode; speed: number }> = [];

  constructor(
    private engine: Engine,
    private canvas: HTMLCanvasElement,
  ) {}

  async create(): Promise<Scene> {
    const scene = new Scene(this.engine);
    scene.clearColor = new Color4(SKY_COLOR.r, SKY_COLOR.g, SKY_COLOR.b, 1);
    scene.ambientColor = new Color3(0.35, 0.38, 0.44);

    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = FOG_DENSITY;
    scene.fogColor = new Color3(SKY_COLOR.r, SKY_COLOR.g, SKY_COLOR.b);

    // Camera — start with ArcRotateCamera; replaced by FollowCamera once local player spawns
    const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 30, Vector3.Zero(), scene);
    camera.attachControl(this.canvas, true);
    scene.activeCamera = camera;
    camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
    camera.lowerRadiusLimit = CAMERA_INITIAL_MIN_ZOOM;
    camera.upperRadiusLimit = CAMERA_INITIAL_MAX_ZOOM;
    this.arcCamera = camera;
    this.sceneRef = scene;

    // ----- Lighting: HDR environment + one shadow-casting sun
    // HDR/IBL gives soft omnidirectional fill across the whole world so
    // every mesh picks up believable ambient light without per-scene tuning.
    // A single directional sun casts the hero shadows.
    const envTex = CubeTexture.CreateFromPrefilteredData('/assets/env/environment.env', scene);
    envTex.gammaSpace = false;
    scene.environmentTexture = envTex;
    scene.environmentIntensity = 0.8;

    // Skybox rendered FROM the env texture so the sky visually matches the
    // lighting that's baked in. Without this, scene.clearColor shows through
    // and ACES tone mapping washes it out.
    const skybox = scene.createDefaultSkybox(envTex, true, 5000, 0.3);
    if (skybox) skybox.isPickable = false;

    // Hemisphere fill is now minimal — env texture does the ambient work,
    // hemi just lifts the StandardMaterial meshes (ground/roads) a touch.
    const hemi = new HemisphericLight('hemiFill', new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = 0.25;
    hemi.diffuse = new Color3(1, 0.97, 0.92);
    hemi.groundColor = new Color3(0.35, 0.4, 0.45);
    hemi.specular = new Color3(0, 0, 0);

    const sun = new DirectionalLight('sunLight', new Vector3(-0.5, -1, -0.3), scene);
    sun.intensity = 1.4;
    sun.diffuse = new Color3(1.0, 0.97, 0.88);
    sun.specular = new Color3(0.2, 0.19, 0.16);
    sun.shadowEnabled = true;
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = 500;

    // Cascaded shadow generator: better quality than a single frustum when
    // the same light has to shadow both nearby avatars AND far buildings.
    const shadowGen = new CascadedShadowGenerator(2048, sun);
    shadowGen.useContactHardeningShadow = true;
    shadowGen.contactHardeningLightSizeUVRatio = 0.06;
    shadowGen.stabilizeCascades = true;
    shadowGen.lambda = 0.8;
    shadowGen.cascadeBlendPercentage = 0.15;
    shadowGen.shadowMaxZ = 500;
    shadowGen.transparencyShadow = true;
    shadowGen.bias = 0.002;
    activeShadowGenerator = shadowGen;

    // ----- Post-processing pipeline: ACES tone mapping + bloom + FXAA
    const pipeline = new DefaultRenderingPipeline('defaultPipeline', true, scene, [camera]);
    pipeline.samples = 2;
    pipeline.fxaaEnabled = true;
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.85;
    pipeline.bloomWeight = 0.22;
    pipeline.bloomKernel = 48;
    pipeline.bloomScale = 0.5;
    pipeline.imageProcessing.toneMappingEnabled = true;
    pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    pipeline.imageProcessing.contrast = 1.05;
    pipeline.imageProcessing.exposure = 1.0;
    pipeline.imageProcessing.vignetteEnabled = true;
    pipeline.imageProcessing.vignetteWeight = 0.6;
    pipeline.imageProcessing.vignetteStretch = 0.5;

    // ---- Uniform parcel grid (async — loads Kenney .glb models) ----
    this.spawnBuildingsAndSetupParcels(scene);

    // ---- Day/Night Cycle ----
    if (features.DAY_NIGHT) {
      this.dayNight = new DayNightCycle(scene, { cycleDurationSeconds: DAY_CYCLE_SECONDS });
      activeDayNight = this.dayNight;
    }

    // Fullscreen GUI layer for floating player name labels
    this.labelUI = AdvancedDynamicTexture.CreateFullscreenUI('playerLabelsUI', true, scene);

    // ---- NPCs ----
    if (features.NPCS) {
      spawnNPCs(scene, this.labelUI);
    }

    // ---- Clouds ----
    this.spawnClouds(scene);

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

    // ---- Keyboard input ----

    this.setupKeyboardInput();

    // ---- Per-frame update ----

    scene.onBeforeRenderObservable.add(() => {
      const dt = this.engine.getDeltaTime() / 1000;
      this.sendPlayerInput();
      this.applyLocalPrediction();
      this.interpolateRemotePlayers();
      this.animateAllAvatars();
      this.trackPlayerWithCamera();
      this.driftClouds(dt);
      if (this.dayNight) {
        this.dayNight.update(dt);
      }
    });

    return scene;
  }

  private async spawnClouds(scene: Scene): Promise<void> {
    try {
      const result = await SceneLoader.ImportMeshAsync(
        '',
        '/assets/models/environment/',
        'cloud.glb',
        scene,
      );
      const root = new TransformNode('cloudTemplate', scene);
      for (const mesh of result.meshes) {
        if (mesh !== result.meshes[0]) {
          mesh.parent = root;
          mesh.isPickable = false;
        }
      }
      result.meshes[0].dispose();
      root.setEnabled(false);

      const COUNT = 16;
      for (let i = 0; i < COUNT; i++) {
        const inst = root.instantiateHierarchy(null, undefined, (src, clone) => {
          clone.name = src.name + '_cloud_' + i;
        });
        if (!inst) continue;
        inst.setEnabled(true);
        const angle = (i / COUNT) * Math.PI * 2;
        const radius = 600 + Math.random() * 700;
        inst.position.set(
          Math.cos(angle) * radius,
          140 + Math.random() * 40,
          Math.sin(angle) * radius,
        );
        inst.scaling.setAll(18 + Math.random() * 18);
        this.cloudInstances.push({ node: inst, speed: 0.6 + Math.random() * 0.8 });
      }
    } catch {
      // cloud.glb not present — skip
    }
  }

  /**
   * Spawn a local-only player when the server is unreachable. Called by
   * Game.start() from its connect() error path so the world is still playable.
   */
  spawnOfflinePlayer(localId: string): void {
    if (!this.sceneRef) return;
    this.localPlayerId = localId;
    this.addRemotePlayer(
      localId,
      { id: localId, name: 'You (Offline)', x: 0, y: 0, z: 0, rotation: 0, color: '#3366cc' },
      this.sceneRef,
    );
  }

  // ---------- Parcel system ----------

  private async spawnBuildingsAndSetupParcels(scene: Scene): Promise<void> {
    for (const p of ALL_PARCELS) {
      this.parcelByDef.set(`${p.x},${p.z}`, p.id);
    }

    const meshes = await spawnBuildings(scene);

    for (const mesh of meshes) {
      // Everything flat receives shadows so avatars cast onto the ground.
      mesh.receiveShadows = true;

      if (mesh.name.startsWith('lot_') && mesh.metadata?.parcelId !== undefined) {
        const parcelId = mesh.metadata.parcelId as number;
        this.parcelRenders.set(parcelId, {
          ground: mesh,
          box: null,
          label: null,
        });

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
      // Try to place a Kenney building model; pick variant deterministically
      // from parcel ID so every parcel always gets the same building.
      const height = data.height ?? 4;
      const variantIdx = def.id % BUILDING_VARIANTS.length;
      const variantName = BUILDING_VARIANTS[variantIdx];
      const scale = Math.max(2, height * 0.7);
      const modelNode = instantiateBuilding(
        scene,
        variantName,
        new Vector3(def.x, 0, def.z),
        scale,
      );

      // Either use a child mesh from the .glb or fall back to a procedural box
      let box: AbstractMesh;
      if (modelNode) {
        const children = modelNode.getChildMeshes(false);
        box = children[0] ?? MeshBuilder.CreateBox(`bizBox_${def.id}`, { size: 1 }, scene);
        box.isPickable = true;
        for (const child of children) {
          child.isPickable = true;
          child.metadata = { parcelId: def.id };
          activeShadowGenerator?.addShadowCaster(child);
        }
      } else {
        const h = Math.max(0.5, height);
        box = MeshBuilder.CreateBox(`bizBox_${def.id}`, { width: 13, height: h, depth: 13 }, scene);
        box.renderOutline = true;
        box.outlineWidth = 0.015;
        box.outlineColor = Color3.Black();
        box.position.set(def.x, h / 2, def.z);
        const mat = new StandardMaterial(`bizMat_${def.id}`, scene);
        mat.diffuseColor = hexToColor3(data.color ?? '#4a90d9');
        mat.specularColor = Color3.Black();
        box.material = mat;
        activeShadowGenerator?.addShadowCaster(box);
      }

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
    const appearance = player.appearance ?? DEFAULT_APPEARANCE;

    const avatar = buildAvatar(scene, sessionId, appearance);
    avatar.root.position.set(player.x, 0, player.z);
    avatar.root.rotation.y = player.rotation ?? 0;

    // Register every avatar mesh as a shadow caster.
    if (activeShadowGenerator) {
      const casters: Array<AbstractMesh | null | undefined> = [
        avatar.head, avatar.body, avatar.legs, avatar.legMeshL, avatar.legMeshR,
        avatar.shoeL, avatar.shoeR, avatar.armLowerL, avatar.armLowerR,
        avatar.handL, avatar.handR, avatar.hat, avatar.accessory,
      ];
      for (const m of casters) {
        if (m) activeShadowGenerator.addShadowCaster(m);
      }
    }

    // Camera + label anchor on the shirt mesh (torso-height) for a nice eye-level target.
    const mesh = avatar.body as AbstractMesh;

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
    labelRect.linkOffsetY = -60;

    this.remotePlayers.set(sessionId, {
      mesh,
      root: avatar.root,
      avatar,
      label: labelRect,
      targetX: player.x,
      targetY: player.y,
      targetZ: player.z,
      targetRotation: player.rotation ?? 0,
      currentColor: appearance.shirt_color,
      appearanceKey: JSON.stringify(appearance),
      prevX: player.x,
      prevZ: player.z,
    });

    // Switch to third-person ArcRotate camera tracking the local player.
    // Standard TPS: camera sits behind the player, WASD moves relative to
    // the camera's forward vector, left-drag orbits the camera around
    // the player, scroll wheel zooms.
    if (isLocal && this.sceneRef) {
      // Reuse the initial ArcRotateCamera instead of creating a new one
      // so its mouse-drag attachment survives. Just re-point its target.
      const cam = this.arcCamera ?? new ArcRotateCamera(
        'playerCamera',
        Math.PI,        // alpha: start looking from +Z (camera behind player when player faces -Z)
        Math.PI / 2.4,  // beta: slight downward tilt
        14,             // radius: distance from player
        new Vector3(player.x, player.y + 1.2, player.z),
        this.sceneRef,
      );
      cam.attachControl(this.canvas, true);
      cam.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
      cam.lowerRadiusLimit = CAMERA_FOLLOW_MIN_ZOOM;
      cam.upperRadiusLimit = CAMERA_FOLLOW_MAX_ZOOM;
      cam.lowerBetaLimit = 0.2;         // don't flip over the top
      cam.upperBetaLimit = Math.PI / 2.05; // don't go below horizontal
      cam.wheelPrecision = 8;
      cam.panningSensibility = 0;
      cam.angularSensibilityX = 300;    // lower = more sensitive
      cam.angularSensibilityY = 300;
      // Inertia must be 0: the character's yaw and movement direction are
      // resampled from the live camera yaw every frame. Any residual
      // rotational inertia decays over several frames, which in-game reads
      // as a "sway" each time the user nudges the mouse (especially on
      // diagonals and direction switches).
      cam.inertia = 0;
      cam.maxZ = 2500;                  // reduce from default 10000 for better depth precision
      cam.useBouncingBehavior = false;
      cam.useAutoRotationBehavior = false;

      // Anchor camera slightly above the player's shoulders, not their feet
      cam.target = new Vector3(player.x, 1.3, player.z);

      this.arcCamera = cam;
      this.localPlayerRoot = avatar.root;
      this.sceneRef.activeCamera = cam;
    }
  }

  private removeRemotePlayer(sessionId: string): void {
    const remote = this.remotePlayers.get(sessionId);
    if (remote) {
      remote.label.dispose();
      disposeAvatar(remote.avatar);
      this.remotePlayers.delete(sessionId);
    }
  }

  private updateRemotePlayerTarget(sessionId: string, player: PlayerSnapshot): void {
    const remote = this.remotePlayers.get(sessionId);
    if (remote) {
      remote.targetX = player.x;
      remote.targetY = player.y;
      remote.targetZ = player.z;
      remote.targetRotation = player.rotation ?? 0;

      // Appearance diff — apply only when the full object actually changed.
      if (player.appearance) {
        const key = JSON.stringify(player.appearance);
        if (key !== remote.appearanceKey) {
          applyAppearance(this.sceneRef!, remote.avatar, player.appearance);
          remote.appearanceKey = key;
          remote.currentColor = player.appearance.shirt_color;
        }
      }

      // For local player: snap ONLY on catastrophic desync — e.g. teleport
      // via fast travel or a connection stall. Normal latency-driven drift
      // is handled entirely by client prediction in applyLocalPrediction;
      // snapping on small diffs caused the start/stop "sway" at faster
      // movement speeds.
      if (sessionId === getSessionId()) {
        const dx = player.x - remote.root.position.x;
        const dz = player.z - remote.root.position.z;
        if (dx * dx + dz * dz > 25 * 25) {
          remote.root.position.x = player.x;
          remote.root.position.z = player.z;
        }
      }
    }
  }

  /**
   * Client-side prediction for the local player so movement feels responsive.
   * MUST match the server's math (camera-yaw-relative, normalised diagonal)
   * to avoid the mesh snapping every time a server PLAYER_STATE broadcast
   * arrives.
   */
  private applyLocalPrediction(): void {
    const localId = getSessionId() ?? this.localPlayerId;
    if (!localId) return;
    const remote = this.remotePlayers.get(localId);
    if (!remote || !this.arcCamera) return;

    const dt = this.engine.getDeltaTime() / 1000;
    const sprintActive = this.keys['ShiftLeft'] || this.keys['ShiftRight'];
    const speed = PLAYER_SPEED * (sprintActive ? SPRINT_MULTIPLIER : 1) * dt;

    // Camera yaw (same math as sendPlayerInput)
    const dir = this.arcCamera.target.subtract(this.arcCamera.position);
    const yaw = Math.atan2(dir.x, dir.z);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);

    let mx = 0, mz = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) { mx += fx; mz += fz; }
    if (this.keys['KeyS'] || this.keys['ArrowDown']) { mx -= fx; mz -= fz; }
    if (this.keys['KeyD'] || this.keys['ArrowRight']) { mx += rx; mz += rz; }
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) { mx -= rx; mz -= rz; }

    const len = Math.hypot(mx, mz);
    if (len > 0) {
      mx /= len; mz /= len;
      remote.root.position.x += mx * speed;
      remote.root.position.z += mz * speed;
    }
    remote.root.rotation.y = yaw;

    // Server reconciliation: hard-snap ONLY on catastrophic desync.
    //
    // Soft per-frame lerping toward the server's last broadcast feels
    // smooth in theory but causes visible sway at the start/stop of
    // movement: the server is always ~1 tick behind the client during
    // acceleration, and ~1 tick ahead right after a stop (it processes
    // one more "moving" tick before the release input lands). Pulling
    // toward either biased target produces a wobble.
    //
    // Because our prediction uses the exact same PLAYER_SPEED, yaw
    // basis, and diagonal-normalisation as the server, position drift
    // accumulates only from variable dt and would take a very long
    // stretch to exceed 10 units. So we trust prediction until the
    // gap is clearly pathological (network stall, teleport, physics
    // anomaly).
    const tx = remote.targetX, tz = remote.targetZ;
    const dxRec = tx - remote.root.position.x;
    const dzRec = tz - remote.root.position.z;
    const distSq = dxRec * dxRec + dzRec * dzRec;
    if (distSq > 25 * 25) {
      remote.root.position.x = tx;
      remote.root.position.z = tz;
    }
  }

  private interpolateRemotePlayers(): void {
    const localId = getSessionId() ?? this.localPlayerId;
    this.remotePlayers.forEach((remote, sessionId) => {
      if (sessionId === localId) return;

      const pos = remote.root.position;
      pos.x += (remote.targetX - pos.x) * REMOTE_PLAYER_LERP;
      pos.y += (remote.targetY - pos.y) * REMOTE_PLAYER_LERP;
      pos.z += (remote.targetZ - pos.z) * REMOTE_PLAYER_LERP;

      // Yaw interpolation, shortest-arc aware
      let dYaw = remote.targetRotation - remote.root.rotation.y;
      while (dYaw > Math.PI) dYaw -= 2 * Math.PI;
      while (dYaw < -Math.PI) dYaw += 2 * Math.PI;
      remote.root.rotation.y += dYaw * REMOTE_PLAYER_LERP;

      // Root is at feet — clamp to ground.
      if (pos.y < 0) pos.y = 0;
    });
  }

  // ---------- Keyboard ----------

  private setupKeyboardInput(): void {
    // Keys we preventDefault() on so the browser doesn't scroll or fire a
    // global shortcut. Shift is deliberately NOT in this set — it's a
    // modifier and we don't want to break Shift+letter capitalisation in
    // the chat input.
    const preventKeys = new Set([
      'KeyW', 'KeyA', 'KeyS', 'KeyD',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Space',
    ]);

    // When the user is typing into an input / textarea (e.g. the chat box),
    // suppress all game-key handling. Otherwise WASD would both type letters
    // AND move the character, and the character could "sprint" just because
    // the user used Shift to capitalise.
    const isTypingInInput = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
    };

    window.addEventListener('keydown', (e) => {
      if (isTypingInInput(e.target)) return;
      if (preventKeys.has(e.code)) e.preventDefault();
      this.keys[e.code] = true;
    });

    window.addEventListener('keyup', (e) => {
      if (preventKeys.has(e.code)) e.preventDefault();
      // Always clear the key on keyup, even when typing — prevents sticky
      // state if the user finished typing while a game key was down.
      this.keys[e.code] = false;
    });

    // Release every tracked key when we lose focus. Without this, alt-tabbing
    // while W or Shift is held leaves the key permanently down because the
    // browser never delivers the keyup — the character would walk or sprint
    // on its own until the user re-presses and releases the key.
    const releaseAllKeys = (): void => {
      for (const code of Object.keys(this.keys)) {
        this.keys[code] = false;
      }
    };
    window.addEventListener('blur', releaseAllKeys);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) releaseAllKeys();
    });
  }

  /**
   * Keep the ArcRotate camera target glued to the local player every frame.
   * Radius / alpha / beta (mouse drag + wheel) remain user-controlled, so the
   * camera orbits around the player as they move.
   */
  private animateAllAvatars(): void {
    const dt = this.engine.getDeltaTime() / 1000;
    const time = performance.now() / 1000;
    this.remotePlayers.forEach((remote) => {
      const pos = remote.root.position;
      const dx = pos.x - remote.prevX;
      const dz = pos.z - remote.prevZ;
      const velocity = Math.hypot(dx, dz) / Math.max(dt, 0.001);
      remote.prevX = pos.x;
      remote.prevZ = pos.z;
      animateAvatar(remote.avatar, velocity, dt, time);
    });
  }

  private driftClouds(dt: number): void {
    for (const c of this.cloudInstances) {
      c.node.position.x += c.speed * dt;
      // wrap to -1500 when they drift off +1500
      if (c.node.position.x > 1500) c.node.position.x = -1500;
    }
  }

  private trackPlayerWithCamera(): void {
    if (!this.arcCamera || !this.localPlayerRoot) return;
    const p = this.localPlayerRoot.position; // world-space (root has no parent)
    // Offset upward so the camera looks at shoulder height, not the feet.
    this.arcCamera.target.set(p.x, p.y + 1.3, p.z);
  }

  private sendPlayerInput(): void {
    // Camera yaw in radians, measured around world +Y axis.
    // ArcRotateCamera.alpha: 0 = camera on +X of target; we want a yaw value
    // where 0 means "facing world -Z" (Babylon's convention). The forward
    // direction from the player is (sin(yaw), 0, cos(yaw)).
    let yaw = 0;
    if (this.arcCamera) {
      // Direction from camera to target, projected onto XZ plane.
      const dir = this.arcCamera.target.subtract(this.arcCamera.position);
      yaw = Math.atan2(dir.x, dir.z);
    }

    const input: PlayerInput = {
      forward: !!this.keys['KeyW'] || !!this.keys['ArrowUp'],
      backward: !!this.keys['KeyS'] || !!this.keys['ArrowDown'],
      left: !!this.keys['KeyA'] || !!this.keys['ArrowLeft'],
      right: !!this.keys['KeyD'] || !!this.keys['ArrowRight'],
      jump: !!this.keys['Space'],
      sprint: !!this.keys['ShiftLeft'] || !!this.keys['ShiftRight'],
      rotation: yaw,
    };

    const isMoving = input.forward || input.backward || input.left || input.right || input.jump;
    const now = performance.now();
    const minInterval = 1000 / TICK_RATE;

    // Also send when only rotation changed (idle but orbiting the camera)
    // so remote players see the character turn in place.
    let yawDelta = Math.abs(yaw - this.lastSentYaw);
    if (yawDelta > Math.PI) yawDelta = 2 * Math.PI - yawDelta;
    const rotationChanged = yawDelta > 0.03; // ~1.7 degrees

    if (!isMoving && this.wasMoving) {
      sendInput(input);
      this.lastInputTime = now;
      this.lastSentYaw = yaw;
    } else if (isMoving && now - this.lastInputTime >= minInterval) {
      sendInput(input);
      this.lastInputTime = now;
      this.lastSentYaw = yaw;
    } else if (!isMoving && rotationChanged && now - this.lastInputTime >= minInterval) {
      sendInput(input);
      this.lastInputTime = now;
      this.lastSentYaw = yaw;
    }

    this.wasMoving = isMoving;
  }
}
