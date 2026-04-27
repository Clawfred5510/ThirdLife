import {
  Scene,
  Engine,
  ArcRotateCamera,
  FollowCamera,
  HemisphericLight,
  DirectionalLight,
  Vector3,
  Color3,
  Color4,
  AbstractMesh,
  Mesh,
  TransformNode,
  ActionManager,
  ExecuteCodeAction,
  DefaultRenderingPipeline,
  CubeTexture,
  ImageProcessingConfiguration,
  ShadowGenerator,
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
  onParcelState,
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
import { spawnBuildings, ALL_PARCELS, ParcelDef } from '../entities/buildings';
import { buildRocket } from '../entities/rocketCenterpiece';
import { buildProceduralBuilding, BUILDING_SPECS, DEFAULT_BUILDING_SPEC, BuildingOutput } from '../entities/proceduralBuilding';
import { spawnNPCs } from '../entities/npcs';
import { selectParcel } from '../../ui/components/ParcelPanel';

/** Module-level reference to the active DayNightCycle for external access. */
let activeDayNight: DayNightCycle | null = null;
/** Sun shadow generator — entity code registers meshes as casters. */
let activeShadowGenerator: ShadowGenerator | null = null;

export function getDayNightCycle(): DayNightCycle | null {
  return activeDayNight;
}

/** Returns the scene's shadow generator, or null before scene create. */
export function getShadowGenerator(): ShadowGenerator | null {
  return activeShadowGenerator;
}

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
  /** The procedural building bundle (only when owned + built). */
  building: BuildingOutput | null;
  /** Anchor mesh for label/picking — derived from building.exteriorCasters[0]. */
  anchor: AbstractMesh | null;
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

  /** Invisible collider mesh that uses moveWithCollisions; root shadows it. */
  private localPlayerCollider: Mesh | null = null;

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

    // Collisions: building walls register checkCollisions=true; the local
    // player's collider mesh uses moveWithCollisions to slide along them.
    scene.collisionsEnabled = true;
    scene.gravity = new Vector3(0, -9.8, 0);

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

    // Hemisphere fill is minimal — env texture does the ambient work.
    // Per technical-artist spec: warm groundColor for the bounce from below
    // (cool grey was over-cooling the under-eaves), intensity 0.08 because
    // the HDR env is already double-lifting otherwise.
    const hemi = new HemisphericLight('hemiFill', new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = 0.08;
    hemi.diffuse = new Color3(1, 0.97, 0.92);
    hemi.groundColor = Color3.FromHexString('#6A5840');
    hemi.specular = new Color3(0, 0, 0);

    const sun = new DirectionalLight('sunLight', new Vector3(-0.5, -1, -0.3), scene);
    sun.intensity = 1.4;
    sun.diffuse = new Color3(1.0, 0.97, 0.88);
    sun.specular = new Color3(0.2, 0.19, 0.16);
    sun.shadowEnabled = true;
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = 200;

    // Simple shadow generator at 1024 — drops the 3-cascade contact-hardening
    // fanciness that was tanking integrated GPUs. Player sees a clean sun
    // shadow from the avatar + buildings, at a fraction of the frame cost.
    const shadowGen = new ShadowGenerator(1024, sun);
    shadowGen.usePercentageCloserFiltering = true;
    shadowGen.filteringQuality = ShadowGenerator.QUALITY_LOW;
    shadowGen.bias = 0.002;
    shadowGen.normalBias = 0.02;
    activeShadowGenerator = shadowGen;

    // ----- Post-processing pipeline: ACES tone mapping + bloom + FXAA.
    // MSAA samples dropped to 1 because FXAA already covers edge AA. Bloom
    // kept cheap (kernel 32, scale 0.5). NO SSAO, NO GlowLayer — both were
    // burning GPU for diminishing returns on a life-sim at-scale target.
    const pipeline = new DefaultRenderingPipeline('defaultPipeline', true, scene, [camera]);
    pipeline.samples = 1;
    pipeline.fxaaEnabled = true;
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.92;
    pipeline.bloomWeight = 0.18;
    pipeline.bloomKernel = 32;
    pipeline.bloomScale = 0.5;
    pipeline.imageProcessing.toneMappingEnabled = true;
    pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    pipeline.imageProcessing.contrast = 1.02;
    pipeline.imageProcessing.exposure = 1.05;
    pipeline.imageProcessing.vignetteEnabled = false;

    // ---- Uniform parcel grid (loads Kenney .glb models) ----
    // Await so parcelRenders is populated before any code that depends on
    // it (e.g. offline-mode demo building seed) runs.
    await this.spawnBuildingsAndSetupParcels(scene);

    // ---- Rocket centerpiece at world origin ----
    buildRocket(scene, Vector3.Zero());

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

    // ---- Parcel state on connect: render every already-claimed parcel ----
    // Without this the bulk snapshot from the server only updates the
    // network cache; visible buildings only appear when the per-parcel
    // PARCEL_UPDATE messages arrive (which never fire on a clean connect).
    // Result: claimed parcels show as empty until clicked. Render them now.
    onParcelState((parcels) => {
      for (const p of parcels) {
        if (p.owner_id) {
          this.handleParcelUpdate(p.id, p);
        }
      }
    });

    // ---- Parcel update listener (incremental — claim, build, sell, recolor) ----
    onParcelUpdate((update: Partial<ParcelData> & { owner_name?: string; error?: string }) => {
      if (update.id === undefined) return;
      this.handleParcelUpdate(update.id, update);
    });

    // ---- Keyboard input ----

    this.setupKeyboardInput();

    // ---- Babylon Inspector toggle (button + backtick hotkey) ----
    // Hotkey was originally Shift+Ctrl+I but every browser reserves that
    // for DevTools and intercepts it before our listener fires. Backtick
    // works as a power-user shortcut, but the button below is the
    // primary discoverable way in.
    let inspectorOpen = false;
    const toggleInspector = async () => {
      try {
        if (!inspectorOpen) {
          // eslint-disable-next-line no-console
          console.log('[inspector] loading…');
          await import('@babylonjs/inspector');
          scene.debugLayer.show({ embedMode: true, overlay: true });
          inspectorOpen = true;
          // eslint-disable-next-line no-console
          console.log('[inspector] open');
        } else {
          scene.debugLayer.hide();
          inspectorOpen = false;
          // eslint-disable-next-line no-console
          console.log('[inspector] closed');
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[inspector] failed to open:', err);
        alert('Inspector failed to open. Open DevTools (F12) → Console tab for the full error.');
      }
    };
    // Expose globally so any UI element can call it (and so the user can
    // type `__tlOpenInspector()` in the JS console as a last-resort fallback).
    (window as unknown as { __tlOpenInspector?: () => Promise<void> }).__tlOpenInspector = toggleInspector;
    window.addEventListener('keydown', async (e) => {
      if (e.code !== 'Backquote') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      e.preventDefault();
      await toggleInspector();
    });

    // Floating button — top-right under the minimap, labeled, hard to miss.
    const btn = document.createElement('button');
    btn.id = 'tl-inspector-btn';
    btn.textContent = '🛠 Inspector';
    btn.title = 'Open Babylon Inspector (or press backtick)';
    Object.assign(btn.style, {
      position: 'fixed',
      top: '180px',     // sits below the 150px minimap (top:16 + 150)
      right: '16px',
      padding: '6px 10px',
      border: '1px solid rgba(255,255,255,0.25)',
      borderRadius: '6px',
      background: 'rgba(124,58,237,0.85)',
      color: '#fff',
      fontSize: '13px',
      fontFamily: 'monospace',
      cursor: 'pointer',
      zIndex: '9999',
      pointerEvents: 'auto',
    } as Partial<CSSStyleDeclaration>);
    btn.addEventListener('click', () => { toggleInspector(); });
    document.body.appendChild(btn);

    // ---- Per-frame update ----

    scene.onBeforeRenderObservable.add(() => {
      const dt = this.engine.getDeltaTime() / 1000;
      this.sendPlayerInput();
      this.applyLocalPrediction();
      this.interpolateRemotePlayers();
      this.animateAllAvatars();
      this.trackPlayerWithCamera();
      this.driftClouds(dt);
      this.updateRoofFade(dt);
      if (this.dayNight) {
        this.dayNight.update(dt);
      }
    });

    // Read-only debug hook for Playwright QA + live-prod inspection. No
    // mutations exposed; just lets a test script find the local avatar and
    // camera state without parsing screenshots. Available in all builds —
    // small attack surface (read-only, well-known mesh names).
    {
      (window as unknown as { __tlDebug?: unknown }).__tlDebug = {
        scene,
        getLocalPlayer: () => {
          const id = this.localPlayerId;
          if (!id) return null;
          const p = this.remotePlayers.get(id);
          if (!p) return null;
          return { x: p.root.position.x, y: p.root.position.y, z: p.root.position.z, id };
        },
        getKeys: () => ({ ...this.keys }),
        getCamInfo: () => {
          const c = this.arcCamera;
          if (!c) return null;
          return { alpha: c.alpha, beta: c.beta, radius: c.radius,
                   targetX: c.target.x, targetZ: c.target.z };
        },
        getCollider: () => {
          const c = this.localPlayerCollider;
          if (!c) return null;
          return {
            x: c.position.x, y: c.position.y, z: c.position.z,
            hasEllipsoid: !!c.ellipsoid, isEnabled: c.isEnabled(),
            isVisible: c.isVisible,
          };
        },
        predictionTick: 0,
      };
    }

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
   * Also seeds a few demo buildings around the spawn so the offline mode
   * shows the procedural building system instead of an empty grid.
   */
  spawnOfflinePlayer(localId: string): void {
    if (!this.sceneRef) return;
    this.localPlayerId = localId;
    this.addRemotePlayer(
      localId,
      { id: localId, name: 'You (Offline)', x: 0, y: 0, z: 0, rotation: 0, color: '#3366cc' },
      this.sceneRef,
    );
    this.seedDemoBuildings();
  }

  /** Spawn one of every building type in a row — offline-mode preview. */
  private seedDemoBuildings(): void {
    const types = Object.keys(BUILDING_SPECS);
    const startGx = 25 - Math.floor(types.length / 2);
    types.forEach((type, i) => {
      const target = ALL_PARCELS.find(p => p.grid_x === startGx + i && p.grid_y === 25);
      if (!target) return;
      this.handleParcelUpdate(target.id, {
        id: target.id,
        owner_id: 'offline-demo',
        business_name: type.charAt(0).toUpperCase() + type.slice(1),
        business_type: type,
        color: BUILDING_SPECS[type].wallColor,
        height: BUILDING_SPECS[type].wallHeight,
      });
    });
    // Teleport the player to stand south of the demo row, looking north.
    const view = ALL_PARCELS.find(p => p.grid_x === 25 && p.grid_y === 24);
    const localId = this.localPlayerId;
    if (view && localId) {
      const remote = this.remotePlayers.get(localId);
      if (remote) {
        remote.root.position.set(view.x, 0, view.z);
        remote.targetX = view.x;
        remote.targetZ = view.z;
      }
    }
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
          building: null,
          anchor: null,
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

    if (renderData.anchor) {
      const meta = renderData.anchor.metadata;
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

    const desiredType = data.business_type ?? renderData.anchor?.metadata?.business_type ?? 'apartment';
    const existingType = renderData.anchor?.metadata?.business_type as string | undefined;
    const typeChanged = renderData.building && existingType !== desiredType;
    // Shop sign text is baked into the mesh at build time. If the business
    // name changed, rebuild so the new name renders on the blade-sign panel.
    const desiredName = (data.business_name ?? renderData.anchor?.metadata?.business_name ?? '') as string;
    const existingName = (renderData.anchor?.metadata?.business_name ?? '') as string;
    const shopNameChanged = desiredType === 'shop' && renderData.building && existingName !== desiredName;

    if (renderData.building && !typeChanged && !shopNameChanged) {
      this.updateBuildingMetaAndLabel(renderData, def, data);
      return;
    }

    if (renderData.building) {
      this.disposeBuilding(renderData);
    }

    const spec = BUILDING_SPECS[desiredType] ?? DEFAULT_BUILDING_SPEC;
    const wallColor = data.color && data.color !== '#4a90d9' ? data.color : spec.wallColor;
    const built = buildProceduralBuilding(
      scene,
      def.id,
      new Vector3(def.x, 0.1, def.z),
      { ...spec, wallColor },
      desiredType,
      desiredName,
    );
    renderData.building = built;
    renderData.anchor = built.exteriorCasters[0] ?? null;

    for (const m of built.exteriorCasters) {
      activeShadowGenerator?.addShadowCaster(m);
      m.isPickable = true;
      m.metadata = {
        parcelId: def.id,
        owner_id: data.owner_id ?? '',
        business_name: data.business_name ?? '',
        business_type: desiredType,
        color: wallColor,
        height: spec.wallHeight,
      };
      m.actionManager = new ActionManager(scene);
      m.actionManager.registerAction(
        new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
          this.onParcelClicked(def.id);
        }),
      );
    }

    this.updateBuildingMetaAndLabel(renderData, def, data);
  }

  private updateBuildingMetaAndLabel(
    renderData: ParcelRenderData,
    def: ParcelDef,
    data: Partial<ParcelData>,
  ): void {
    if (!renderData.anchor || !renderData.building) return;
    const merged = {
      parcelId: def.id,
      owner_id: data.owner_id ?? renderData.anchor.metadata?.owner_id ?? '',
      business_name: data.business_name ?? renderData.anchor.metadata?.business_name ?? '',
      business_type: data.business_type ?? renderData.anchor.metadata?.business_type ?? 'apartment',
      color: data.color ?? renderData.anchor.metadata?.color ?? '#4a90d9',
      height: data.height ?? renderData.anchor.metadata?.height ?? 4,
    };
    for (const m of renderData.building.exteriorCasters) m.metadata = merged;

    const name = (data.business_name ?? renderData.anchor.metadata?.business_name ?? '').trim();
    if (!name) {
      if (renderData.label) { renderData.label.dispose(); renderData.label = null; }
      return;
    }
    if (renderData.label) {
      const tb = renderData.label.children?.[0] as TextBlock | undefined;
      if (tb) tb.text = name;
      return;
    }
    const labelRect = new Rectangle(`bizLabel_${def.id}`);
    labelRect.width = '160px';
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
    labelRect.linkWithMesh(renderData.anchor);
    labelRect.linkOffsetY = -180;
    renderData.label = labelRect;
  }

  private disposeBuilding(renderData: ParcelRenderData): void {
    if (renderData.building) {
      renderData.building.root.dispose(false, true);
      renderData.building = null;
      renderData.anchor = null;
    }
  }

  private removeBusinessFromParcel(renderData: ParcelRenderData): void {
    this.disposeBuilding(renderData);
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
      // alpha = -π/2 puts the camera on -Z side of the target. The player
      // yaw is derived from camera-to-target direction (`sendPlayerInput`),
      // so this makes the player face +Z (toward the rocket at world
      // origin) on first frame.
      const cam = this.arcCamera ?? new ArcRotateCamera(
        'playerCamera',
        -Math.PI / 2,
        Math.PI / 2.6,
        14,
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

      // Order matters: assigning `cam.target` triggers Babylon's
      // ArcRotateCamera to RECOMPUTE alpha/beta/radius from the camera's
      // current world position relative to the new target. So we must
      // (1) re-target onto the player first, then (2) overwrite
      // alpha/beta/radius. Doing it in the other order silently clobbers
      // our spawn-framing values.
      cam.target = new Vector3(player.x, 1.3, player.z);
      cam.alpha = -Math.PI / 2;        // camera south of target → player yaw 0 → faces +Z toward rocket
      cam.beta = Math.PI / 2.6;        // slight upward tilt so rocket's upper body is in frame
      cam.radius = 14;

      this.arcCamera = cam;
      this.localPlayerRoot = avatar.root;
      this.localPlayerCollider = this.makeLocalCollider(this.sceneRef, player.x, player.z);
      this.sceneRef.activeCamera = cam;
    }
  }

  /** Hidden ellipsoid collider for the local player. The avatar root copies
   *  its position each frame after moveWithCollisions has slid it along walls.
   */
  private makeLocalCollider(scene: Scene, x: number, z: number): Mesh {
    const c = new Mesh('localCollider', scene);
    c.position.set(x, 1.0, z);
    c.ellipsoid = new Vector3(0.55, 1.0, 0.55);
    c.ellipsoidOffset = new Vector3(0, 1.0, 0);
    c.checkCollisions = true;
    c.isVisible = false;
    c.isPickable = false;
    return c;
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

      // Snap only on catastrophic desync for the local player — and only
      // when we actually have a server session (offline mode leaves the
      // server-target frozen at spawn, which would yank the player back
      // after every short walk).
      const activeSid = getSessionId();
      if (activeSid && sessionId === activeSid) {
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
    if (import.meta.env.DEV) {
      const dbg = (window as unknown as { __tlDebug?: { predictionTick: number } }).__tlDebug;
      if (dbg) dbg.predictionTick += 1;
    }

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
      const dx = mx * speed;
      const dz = mz * speed;
      const collider = this.localPlayerCollider;
      if (collider) {
        // Sync collider to authoritative root position (in case server snap or
        // network update moved the avatar), then apply movement with sliding.
        collider.position.x = remote.root.position.x;
        collider.position.z = remote.root.position.z;
        collider.moveWithCollisions(new Vector3(dx, 0, dz));
        remote.root.position.x = collider.position.x;
        remote.root.position.z = collider.position.z;
      } else {
        remote.root.position.x += dx;
        remote.root.position.z += dz;
      }
    }
    remote.root.rotation.y = yaw;

    // Server reconciliation: hard-snap ONLY on catastrophic desync.
    //
    // Threshold is intentionally generous (60 units ≈ 3s of sprint) because
    // legitimate prediction drift can briefly cross 25 units when:
    //   - the browser frame stalls (GC pause, tab refocus)
    //   - the user rotates the camera fast while moving (server's `forward`
    //     direction lags one input-tick behind client's)
    //   - the network briefly buffers inputs
    // A small drift left uncorrected is invisible; a snap-back to a stale
    // server position is very visible. Bias toward never snapping.
    //
    // Soft per-frame lerping was tried and caused visible sway at start/
    // stop of movement (server is ~1 tick behind during accel, ~1 tick
    // ahead after a stop). Hard snap on catastrophic-only is the right
    // tradeoff.
    //
    // Telemetry: log snaps to console so we can observe frequency in prod.
    // Each entry: delta magnitude + which axis dominates.
    if (getSessionId()) {
      const tx = remote.targetX, tz = remote.targetZ;
      const dxRec = tx - remote.root.position.x;
      const dzRec = tz - remote.root.position.z;
      const distSq = dxRec * dxRec + dzRec * dzRec;
      if (distSq > 60 * 60) {
        const dist = Math.sqrt(distSq);
        console.warn(`[reconcile] snap ${dist.toFixed(1)}u back to server (dx=${dxRec.toFixed(1)}, dz=${dzRec.toFixed(1)})`);
        remote.root.position.x = tx;
        remote.root.position.z = tz;
      }
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

  /**
   * RuneScape-style roof fade when the local player is inside a
   * building's footprint. Roof meshes lerp to visibility=0, then get
   * setEnabled(false) once fully faded so transparent PBR edge cases
   * can't leak through. Wall-shrink for tall interiors is a future
   * follow-up (needs door-lintel-safe geometry split).
   */
  private updateRoofFade(dt: number): void {
    if (!this.localPlayerRoot) return;
    const px = this.localPlayerRoot.position.x;
    const pz = this.localPlayerRoot.position.z;
    const FADE_SPEED = 6;

    this.parcelRenders.forEach((data) => {
      const b = data.building;
      if (!b) return;
      const [cx, cz] = b.centerXZ;
      const [hx, hz] = b.halfExtentsXZ;
      const inside = Math.abs(px - cx) < hx && Math.abs(pz - cz) < hz;
      const target = inside ? 0 : 1;

      for (const m of b.roofMeshes) {
        const cur = m.visibility ?? 1;
        if (cur !== target) {
          const diff = target - cur;
          const step = Math.sign(diff) * Math.min(Math.abs(diff), FADE_SPEED * dt);
          m.visibility = cur + step;
        }
        if (m.visibility <= 0.01 && m.isEnabled()) m.setEnabled(false);
        else if (m.visibility > 0.01 && !m.isEnabled()) m.setEnabled(true);
      }
    });
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
