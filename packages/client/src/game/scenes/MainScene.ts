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
  sendRespawn,
  getSessionId,
  PlayerSnapshot,
  onParcelState,
  onParcelUpdate,
} from '../../network/Client';
import {
  InputCommand,
  simulateMovement,
  MAX_COMMAND_DT,
  RECONCILE_SNAP_DISTANCE,
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
  INTERP_DELAY_MS,
  sampleSnapshot,
  SPAWN_POINT,
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
  labelText: TextBlock;
  /** Optional bot-kind badge above the name (AUTO / AGENT). Humans null. */
  badge: Rectangle | null;
  badgeKind: 'auto' | 'agent' | 'external' | null;
  rank: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | null;
  /** Newest position reported by the server. */
  targetX: number;
  targetY: number;
  targetZ: number;
  targetRotation: number;
  /** Previous server-reported position + the wall-clock ms it arrived at.
   *  interpolateRemotePlayers interpolates BETWEEN (prevTarget, target) over
   *  (prevTargetAt, targetAt) at a fixed delay behind real time — constant
   *  velocity between broadcasts, and it never overshoots the latest
   *  snapshot (see sampleSnapshot / INTERP_DELAY_MS). */
  prevTargetX: number;
  prevTargetZ: number;
  prevTargetAt: number;
  targetAt: number;
  currentColor: string;
  appearanceKey: string;
  /** Last frame's rendered position — used by animateAvatar to drive the
   *  walk cycle from instantaneous velocity. */
  prevX: number;
  prevZ: number;
}

/** Phase 4: nameplate color per rank. White for the unranked default
 *  matches the legacy look; the metallic palette differentiates the five
 *  tiers without losing readability against the warm world palette. */
function rankNameplateColor(rank: PlayerSnapshot['rank']): string {
  switch (rank) {
    case 'bronze':   return '#CD7F32';
    case 'silver':   return '#C0C0C0';
    case 'gold':     return '#FFD700';
    case 'platinum': return '#E5E4E2';
    case 'diamond':  return '#B9F2FF';
    default:         return '#FFFFFF';
  }
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

  /** Virtual-input state from the on-screen joystick (mobile UX).
   *  Merged with the keyboard state in sendPlayerInput. */
  private virtual: { forward: boolean; backward: boolean; left: boolean; right: boolean; sprint: boolean } = {
    forward: false, backward: false, left: false, right: false, sprint: false,
  };

  /** Day/night cycle system. */
  private dayNight!: DayNightCycle;

  /** Last yaw sent to the server — used to emit a no-move command when the
   *  player orbits the camera while standing still (so remotes see the turn). */
  private lastSentYaw = 0;

  // ── Client-side prediction + server reconciliation (authoritative-server
  //    movement). The local avatar predicts input commands locally and
  //    replays the un-acked ones on each server snapshot — no lerp, no drift. ──
  /** Monotonic input-command sequence counter for the local player. */
  private localSeq = 0;
  /** Sent-but-not-yet-acked commands (oldest first); replayed on reconcile,
   *  pruned by the server's acked seq. */
  private pendingCommands: InputCommand[] = [];
  /** Pure (collision-free) predicted local position — the exact value the
   *  server also computes, so reconciliation has ~zero error on open ground.
   *  The rendered avatar follows this through collision. */
  private localPureX = 0;
  private localPureZ = 0;

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
      // Appearance / rank / badge updates apply to everyone (incl. self).
      this.updateRemotePlayerTarget(sessionId, player);
      // The local player additionally reconciles position against the
      // authoritative snapshot (snap to server + replay un-acked commands).
      const localId = getSessionId() ?? this.localPlayerId;
      if (sessionId === localId) {
        this.reconcileLocal(player.x, player.z, player.seq ?? 0);
      }
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

    // Phone "Spawn" app dispatches `tl-respawn` — send the server message
    // (so other players see us snap too) and locally snap the avatar,
    // collider, and camera target. Local prediction owns x/z, so the
    // server's PLAYER_UPDATE wouldn't move us without this hand-off.
    window.addEventListener('tl-respawn', () => this.respawnLocal());

    // ---- Keyboard input ----

    this.setupKeyboardInput();

    // ---- Per-frame update ----

    scene.onBeforeRenderObservable.add(() => {
      const dt = this.engine.getDeltaTime() / 1000;
      this.predictAndSendLocal();
      this.interpolateRemotePlayers();
      this.animateAllAvatars();
      this.trackPlayerWithCamera();
      this.driftClouds(dt);
      this.updateRoofFade(dt);
      this.updateBuildingLabelFocus(dt * 1000);
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
        this.localPureX = view.x;
        this.localPureZ = view.z;
        this.pendingCommands = [];
        if (this.localPlayerCollider) {
          this.localPlayerCollider.position.set(view.x, 1.0, view.z);
        }
      }
    }
  }

  /** Snap the local player back to world spawn. Triggered by the phone's
   *  "Spawn" app via the `tl-respawn` window event. Also notifies the
   *  server so other clients see the teleport. */
  private respawnLocal(): void {
    sendRespawn();
    const localId = getSessionId() ?? this.localPlayerId;
    if (!localId) return;
    const remote = this.remotePlayers.get(localId);
    if (!remote) return;
    remote.root.position.set(SPAWN_POINT.x, SPAWN_POINT.y, SPAWN_POINT.z);
    remote.root.rotation.y = 0;
    remote.targetX = SPAWN_POINT.x;
    remote.targetY = SPAWN_POINT.y;
    remote.targetZ = SPAWN_POINT.z;
    remote.targetRotation = 0;
    remote.prevX = SPAWN_POINT.x;
    remote.prevZ = SPAWN_POINT.z;
    // Re-seed prediction so the next reconciliation doesn't yank the avatar
    // back from spawn (the in-flight commands targeted the old position).
    this.localPureX = SPAWN_POINT.x;
    this.localPureZ = SPAWN_POINT.z;
    this.pendingCommands = [];
    if (this.localPlayerCollider) {
      this.localPlayerCollider.position.set(SPAWN_POINT.x, 1.0, SPAWN_POINT.z);
    }
    if (this.arcCamera) {
      this.arcCamera.target = new Vector3(SPAWN_POINT.x, SPAWN_POINT.y + 1.3, SPAWN_POINT.z);
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

    // Phase 6: clicking any built Market building opens the Phone's
    // Market app directly. The plot-side shortcut from spec §8 — no
    // need to fish through the home grid. ParcelPanel still opens too,
    // so the player keeps the usual context (claim / demolish / etc.).
    if (parcelInfo.business_type === 'market') {
      window.dispatchEvent(new CustomEvent('tl-open-app', { detail: { app: 'market' } }));
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

    // Owned but the building was explicitly cleared (demolish) — strip any
    // rendered building so the plot is bare, while the parcel STAYS owned
    // (the server keeps owner_id). The demolish broadcast AND the reconnect
    // PARCEL_STATE snapshot both carry business_type:''. Require the field to
    // be PRESENT and empty so partial updates that omit it (rename / recolor)
    // never wrongly clear a building. Without this, an empty business_type
    // fell through to updateOrCreateBusinessBox and was coerced to the default
    // 'apartment' spec — the "shadow building" ghost (and it returned on
    // reconnect via the same snapshot path).
    if ('business_type' in data && (data.business_type === '' || data.business_type === 'none')) {
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

    if (renderData.building && !typeChanged) {
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
    // Hidden by default — updateBuildingLabelFocus() shows exactly one label
    // (the closest building the player is looking at) per frame. Without this
    // every named building's tag would be visible at once.
    labelRect.isVisible = false;
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

  /** Build a small AUTO/AGENT/EXT badge above an avatar's name plate. */
  private buildBotBadge(sessionId: string, kind: 'auto' | 'agent' | 'external', mesh: AbstractMesh): Rectangle {
    const rect = new Rectangle(`badge_${sessionId}`);
    rect.width = '60px';
    rect.height = '18px';
    rect.cornerRadius = 4;
    rect.thickness = 1;
    let label: string;
    if (kind === 'auto') {
      rect.background = 'rgba(63,122,61,0.75)';     // forest green (AUTO)
      rect.color = '#86efac';
      label = 'AUTO';
    } else if (kind === 'external') {
      // Brighter green for EXT to set external agents apart from
      // server-autopilot ones — matches the Phone Agents tab theme.
      rect.background = 'rgba(63,122,61,0.95)';
      rect.color = '#9FD89A';
      label = 'EXT';
    } else {
      rect.background = 'rgba(216,148,56,0.75)';    // amber (AGENT)
      rect.color = '#fde68a';
      label = 'AGENT';
    }
    const text = new TextBlock(`badgeText_${sessionId}`, label);
    text.color = '#0F0A07';
    text.fontSize = 10;
    text.fontWeight = 'bold';
    rect.addControl(text);
    this.labelUI.addControl(rect);
    rect.linkWithMesh(mesh);
    rect.linkOffsetY = -82; // sits above the name plate (which is at -60)
    return rect;
  }

  /** Reconcile an existing avatar's badge with a new bot_kind. */
  private syncBotBadge(sessionId: string, render: RemotePlayer, kind: 'auto' | 'agent' | 'external' | undefined): void {
    if (!kind) {
      if (render.badge) { render.badge.dispose(); render.badge = null; render.badgeKind = null; }
      return;
    }
    if (render.badgeKind === kind && render.badge) return;
    if (render.badge) { render.badge.dispose(); render.badge = null; }
    render.badge = this.buildBotBadge(sessionId, kind, render.mesh);
    render.badgeKind = kind;
  }

  private addRemotePlayer(sessionId: string, player: PlayerSnapshot, scene: Scene): void {
    const isLocal = sessionId === getSessionId() || sessionId === this.localPlayerId;
    const appearance = player.appearance ?? DEFAULT_APPEARANCE;

    const avatar = buildAvatar(scene, sessionId, appearance, {
      botKind: player.bot_kind,
      botCategory: player.bot_category,
      // The avatar registers/deregisters its own skinned meshes as shadow
      // casters across the async GLB load (and any model swap), so we don't
      // touch the shadow generator here.
      shadowGenerator: activeShadowGenerator,
    });
    avatar.root.position.set(player.x, 0, player.z);
    avatar.root.rotation.y = player.rotation ?? 0;

    // Camera + label/badge anchor: an invisible torso-height node on the avatar
    // root that exists immediately (the GLB streams in async under it).
    const mesh = avatar.body as AbstractMesh;

    // UI Overhaul (2026-05-20): make the agent body clickable so the player can
    // pop up the AgentInfoPanel from the 3D world. Only AI agents (bot_kind
    // set). The GLB meshes load async, so wire pick targets via onReady — it
    // re-fires if the droid model swaps (workplace category change).
    if (!isLocal && player.bot_kind && this.sceneRef) {
      const sceneForPick = this.sceneRef;
      avatar.onReady((meshes) => {
        for (const m of meshes) {
          m.isPickable = true;
          m.actionManager = new ActionManager(sceneForPick);
          m.actionManager.registerAction(
            new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
              window.dispatchEvent(new CustomEvent('tl-agent-clicked', {
                detail: { agentId: sessionId, name: player.name },
              }));
            }),
          );
        }
      });
    }

    // Floating name label
    const labelRect = new Rectangle(`label_${sessionId}`);
    labelRect.width = '100px';
    labelRect.height = '30px';
    labelRect.cornerRadius = 4;
    labelRect.color = 'transparent';
    labelRect.background = 'transparent';
    labelRect.thickness = 0;

    const labelText = new TextBlock(`labelText_${sessionId}`, player.name);
    labelText.color = rankNameplateColor(player.rank ?? null);
    labelText.fontSize = 14;
    labelText.resizeToFit = true;
    labelRect.addControl(labelText);

    this.labelUI.addControl(labelRect);
    labelRect.linkWithMesh(mesh);
    labelRect.linkOffsetY = -60;

    // AUTO / AGENT badge above the name, only for AI agents. The
    // discriminator comes from the server-side bot_kind field; humans
    // omit it entirely and get no badge.
    let badge: Rectangle | null = null;
    if (player.bot_kind) {
      badge = this.buildBotBadge(sessionId, player.bot_kind, mesh);
    }

    const now = performance.now();
    this.remotePlayers.set(sessionId, {
      mesh,
      root: avatar.root,
      avatar,
      label: labelRect,
      labelText,
      badge,
      badgeKind: player.bot_kind ?? null,
      rank: player.rank ?? null,
      targetX: player.x,
      targetY: player.y,
      targetZ: player.z,
      targetRotation: player.rotation ?? 0,
      prevTargetX: player.x,
      prevTargetZ: player.z,
      prevTargetAt: now,
      targetAt: now,
      currentColor: appearance.shirt_color,
      // Key includes bot_kind/bot_category so a droid model swap (workplace
      // built/changed) or a human's character pick triggers a reload.
      appearanceKey: JSON.stringify({ a: appearance, k: player.bot_kind, c: player.bot_category }),
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
      // Full 360° around the character: alpha is explicitly unbounded
      // (Babylon's default, but state it so future tweaks don't flip
      // a sneaky limit on by accident).
      cam.lowerAlphaLimit = null;
      cam.upperAlphaLimit = null;
      // Vertical: open up close-to-overhead and almost-horizontal,
      // but stop just shy of gimbal-flipping so the camera can't
      // invert.
      cam.lowerBetaLimit = 0.10;
      cam.upperBetaLimit = Math.PI / 2.05;
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
      // Seed the predicted pure position to the spawn position so the first
      // reconciliation against the server has no error.
      this.localPureX = player.x;
      this.localPureZ = player.z;
      this.pendingCommands = [];
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
      if (remote.badge) remote.badge.dispose();
      disposeAvatar(remote.avatar);
      this.remotePlayers.delete(sessionId);
    }
  }

  private updateRemotePlayerTarget(sessionId: string, player: PlayerSnapshot): void {
    const remote = this.remotePlayers.get(sessionId);
    if (remote) {
      // Roll the snapshot history. interpolateRemotePlayers interpolates
      // between these two snapshots (prev → latest) at a fixed delay behind
      // real time, so motion BETWEEN broadcasts is constant-velocity and a
      // stopped player holds exactly at the latest authoritative position
      // (no extrapolation overshoot).
      remote.prevTargetX = remote.targetX;
      remote.prevTargetZ = remote.targetZ;
      remote.prevTargetAt = remote.targetAt;
      remote.targetAt = performance.now();
      remote.targetX = player.x;
      remote.targetY = player.y;
      remote.targetZ = player.z;
      remote.targetRotation = player.rotation ?? 0;

      // Server may have toggled the agent's autopilot. Reconcile the badge.
      this.syncBotBadge(sessionId, remote, player.bot_kind);

      // Rank may have changed (promotion via burn). Recolor the nameplate.
      const newRank = player.rank ?? null;
      if (newRank !== remote.rank) {
        remote.rank = newRank;
        remote.labelText.color = rankNameplateColor(newRank);
      }

      // Model diff — reload only when the resolved GLB would change: a human's
      // character pick, or a bot's workplace category (bot_category) changing.
      // bot_kind/bot_category live outside `appearance`, so fold them into key.
      const appr = player.appearance ?? DEFAULT_APPEARANCE;
      const key = JSON.stringify({ a: appr, k: player.bot_kind, c: player.bot_category });
      if (key !== remote.appearanceKey) {
        applyAppearance(this.sceneRef!, remote.avatar, appr, {
          botKind: player.bot_kind,
          botCategory: player.bot_category,
        });
        remote.appearanceKey = key;
        remote.currentColor = appr.shirt_color;
      }

      // (No snap here for the local player. Reconciliation is owned by
      // applyLocalPrediction, which fires every render frame with a
      // generous 60u catastrophic-only threshold. There USED to be a
      // duplicate 25u snap in this method that ran every PLAYER_STATE
      // broadcast (10 Hz) — caused the random "teleport during movement"
      // the user reported. updateRemotePlayerTarget now only updates the
      // interpolation target.)
    }
  }

  /**
   * Client-side prediction + command send (authoritative-server model). Runs
   * every render frame. When the player has movement input — or has turned the
   * camera while standing still — build one InputCommand for this frame's dt,
   * apply it locally via the SHARED simulateMovement (so the server computes
   * the identical result), buffer it for replay, and send it. The avatar
   * renders by following the pure predicted position through collision. Idle
   * and not turning → nothing is sent: the server holds the last position and
   * reconciliation is a no-op (this is why there's no more post-release slide).
   */
  private predictAndSendLocal(): void {
    const localId = getSessionId() ?? this.localPlayerId;
    if (!localId || !this.arcCamera) return;
    const remote = this.remotePlayers.get(localId);
    if (!remote) return;

    // Clamp dt to MAX_COMMAND_DT (same clamp the server applies) so a long /
    // backgrounded frame can't teleport, and a given command moves both sides
    // identically.
    const dt = Math.min(this.engine.getDeltaTime() / 1000, MAX_COMMAND_DT);

    // Camera yaw — the single yaw source the avatar faces AND the server
    // stores, so client prediction and server simulation never diverge.
    const dir = this.arcCamera.target.subtract(this.arcCamera.position);
    const yaw = Math.atan2(dir.x, dir.z);
    remote.root.rotation.y = yaw;

    const forward = !!this.keys['KeyW'] || !!this.keys['ArrowUp'] || this.virtual.forward;
    const backward = !!this.keys['KeyS'] || !!this.keys['ArrowDown'] || this.virtual.backward;
    const left = !!this.keys['KeyA'] || !!this.keys['ArrowLeft'] || this.virtual.left;
    const right = !!this.keys['KeyD'] || !!this.keys['ArrowRight'] || this.virtual.right;
    const sprint = !!this.keys['ShiftLeft'] || !!this.keys['ShiftRight'] || this.virtual.sprint;
    const moving = forward || backward || left || right;

    let yawDelta = Math.abs(yaw - this.lastSentYaw);
    if (yawDelta > Math.PI) yawDelta = 2 * Math.PI - yawDelta;
    const turned = yawDelta > 0.03; // ~1.7°

    // Nothing to send when idle and not turning — server holds the position.
    if (!moving && !turned) return;

    const cmd: InputCommand = {
      seq: ++this.localSeq,
      dt,
      forward, backward, left, right, sprint,
      yaw,
    };
    this.lastSentYaw = yaw;

    const before = { x: this.localPureX, z: this.localPureZ };
    const after = simulateMovement(before, cmd);
    this.localPureX = after.x;
    this.localPureZ = after.z;

    this.pendingCommands.push(cmd);
    // Bound the buffer so dropped acks / a long stall can't grow it forever.
    if (this.pendingCommands.length > 256) this.pendingCommands.shift();
    sendInput(cmd);

    this.applyLocalRenderDelta(remote, after.x - before.x, after.z - before.z);
  }

  /**
   * Server reconciliation. On each authoritative snapshot for the local
   * player: snap the pure position to the server's, drop acknowledged
   * commands, and replay the rest through the SAME simulateMovement. On open
   * ground with matching math this reproduces the current predicted position
   * exactly (zero visible correction); after a genuine divergence the avatar
   * lands where it should with NO lerp drag (that drag was the ice/rubber-band).
   * A teleport-scale correction (respawn / fast-travel) is hard-snapped.
   */
  private reconcileLocal(serverX: number, serverZ: number, ackSeq: number): void {
    const localId = getSessionId() ?? this.localPlayerId;
    if (!localId) return;
    const remote = this.remotePlayers.get(localId);
    if (!remote) return;

    if (ackSeq > 0) {
      this.pendingCommands = this.pendingCommands.filter((c) => c.seq > ackSeq);
    }

    let px = serverX, pz = serverZ;
    for (const c of this.pendingCommands) {
      const r = simulateMovement({ x: px, z: pz }, c);
      px = r.x; pz = r.z;
    }

    const dx = px - this.localPureX;
    const dz = pz - this.localPureZ;
    this.localPureX = px;
    this.localPureZ = pz;

    if (Math.hypot(dx, dz) > RECONCILE_SNAP_DISTANCE) {
      // Teleport-scale correction — snap hard (don't slide through walls).
      remote.root.position.x = px;
      remote.root.position.z = pz;
      if (this.localPlayerCollider) {
        this.localPlayerCollider.position.x = px;
        this.localPlayerCollider.position.z = pz;
      }
      return;
    }
    // Small correction (usually ~0) — carry it through collision.
    this.applyLocalRenderDelta(remote, dx, dz);
  }

  /**
   * Move the rendered local avatar by (dx,dz), sliding against building
   * colliders via moveWithCollisions so it never clips through walls. The pure
   * predicted position (localPureX/Z) is the collision-free truth the server
   * agrees on; the rendered collider follows it.
   */
  private applyLocalRenderDelta(remote: RemotePlayer, dx: number, dz: number): void {
    if (dx === 0 && dz === 0) return;
    const collider = this.localPlayerCollider;
    if (collider) {
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

  private interpolateRemotePlayers(): void {
    const localId = getSessionId() ?? this.localPlayerId;
    const now = performance.now();

    // Render remote avatars slightly in the past (now − INTERP_DELAY_MS) and
    // interpolate BETWEEN the two most recent server snapshots — never
    // extrapolate beyond the latest. sampleSnapshot clamps the interpolation
    // factor to [0, 1], so once the latest snapshot is older than the delay
    // (no newer packet has arrived, e.g. the player stopped) the avatar holds
    // EXACTLY at its authoritative position. This replaces the velocity
    // extrapolation that shipped 2026-05-28, which derived velocity from
    // jittery client packet-arrival timestamps and projected forward — that
    // flung just-stopped avatars past their true spot and left moving ones at
    // positions the server never sent, i.e. the "remote players settle
    // off-position" bug. Per network-code.md: remote avatars use server
    // interpolation only, no prediction.
    const renderTime = now - INTERP_DELAY_MS;
    // Yaw still eases toward the latest reported rotation (time-based so it's
    // frame-rate independent). Rotation snaps are far less noticeable than
    // positional ones, and the server only sends the freshest yaw.
    const yawSmoothing = 1 - Math.pow(1 - REMOTE_PLAYER_LERP, (this.engine.getDeltaTime() / 1000) * 60);

    this.remotePlayers.forEach((remote, sessionId) => {
      if (sessionId === localId) return;

      const pos = remote.root.position;
      pos.x = sampleSnapshot(remote.prevTargetX, remote.targetX, remote.prevTargetAt, remote.targetAt, renderTime);
      pos.z = sampleSnapshot(remote.prevTargetZ, remote.targetZ, remote.prevTargetAt, remote.targetAt, renderTime);
      // y rarely changes (root sits at feet, clamped to ground); a light ease
      // toward the latest value handles the occasional jump without jitter.
      pos.y += (remote.targetY - pos.y) * yawSmoothing;

      // Yaw interpolation, shortest-arc aware (time-based).
      let dYaw = remote.targetRotation - remote.root.rotation.y;
      while (dYaw > Math.PI) dYaw -= 2 * Math.PI;
      while (dYaw < -Math.PI) dYaw += 2 * Math.PI;
      remote.root.rotation.y += dYaw * yawSmoothing;

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

    // Bridge for the on-screen joystick (mobile UX). The React Joystick
    // component calls window.__tlSetVirtualInput({ forward, backward,
    // left, right, sprint }) on every state change. Cleared on blur so
    // touch + page-switch can't strand the player walking forever.
    interface VirtualInput { forward: boolean; backward: boolean; left: boolean; right: boolean; sprint: boolean }
    (window as unknown as { __tlSetVirtualInput?: (s: VirtualInput) => void })
      .__tlSetVirtualInput = (s) => { this.virtual = { ...s }; };
    const releaseVirtual = () => {
      this.virtual.forward = this.virtual.backward = this.virtual.left = this.virtual.right = this.virtual.sprint = false;
    };
    window.addEventListener('blur', releaseVirtual);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) releaseVirtual();
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

  /** ms since the last label-focus recompute (throttled to ~10 Hz). */
  private labelFocusAccumMs = 0;

  /**
   * Show the floating name tag for ONLY the single closest building the
   * player is looking at; keep every other building's tag hidden. Building
   * labels are created hidden (updateBuildingMetaAndLabel) and this is the
   * only place that ever shows one, so the result is exactly one visible tag
   * at a time (or none, when no building is in view+range).
   *
   * "Looking at" = the camera's forward direction on the XZ plane, which is
   * also the player's facing (player yaw = camera yaw, Roblox follow-cam).
   * A building qualifies if it is within MAX_RANGE and inside a ~35° cone in
   * front of the player, OR if the player is standing inside its footprint
   * (degenerate direction — always show the building you're in). Among
   * qualifiers, the nearest wins.
   *
   * Throttled to ~10 Hz — avatar/camera motion between recomputes is far
   * smaller than the cone, so focus never visibly lags. Toggle-only
   * (isVisible), never dispose/recreate, per engine-code.md.
   */
  private updateBuildingLabelFocus(dtMs: number): void {
    this.labelFocusAccumMs += dtMs;
    if (this.labelFocusAccumMs < 100) return;
    this.labelFocusAccumMs = 0;

    let bestId: number | null = null;
    if (this.localPlayerRoot && this.arcCamera) {
      const px = this.localPlayerRoot.position.x;
      const pz = this.localPlayerRoot.position.z;
      // Camera forward on XZ (same convention as sendPlayerInput): yaw =
      // atan2(dir.x, dir.z), forward = (sin yaw, cos yaw).
      const dir = this.arcCamera.target.subtract(this.arcCamera.position);
      const yaw = Math.atan2(dir.x, dir.z);
      const fx = Math.sin(yaw), fz = Math.cos(yaw);

      const MAX_RANGE_SQ = 60 * 60;  // beyond ~60u no label shows
      const VIEW_DOT = 0.82;         // cos(~35°): building must be ~in front
      let bestDistSq = Infinity;

      this.parcelRenders.forEach((data, parcelId) => {
        const b = data.building;
        if (!b || !data.label) return;
        const [cx, cz] = b.centerXZ;
        const toX = cx - px, toZ = cz - pz;
        const distSq = toX * toX + toZ * toZ;
        const [hx, hz] = b.halfExtentsXZ;
        const inside = Math.abs(toX) < hx && Math.abs(toZ) < hz;
        if (!inside) {
          if (distSq > MAX_RANGE_SQ) return;
          const dist = Math.sqrt(distSq) || 1;
          if ((toX * fx + toZ * fz) / dist < VIEW_DOT) return; // outside cone
        }
        if (distSq < bestDistSq) { bestDistSq = distSq; bestId = parcelId; }
      });
    }

    // Apply: exactly the winner is visible. isVisible is a no-op when the
    // flag is unchanged, so this stays cheap even over the full parcel map.
    this.parcelRenders.forEach((data, parcelId) => {
      if (data.label) data.label.isVisible = parcelId === bestId;
    });
  }

  private trackPlayerWithCamera(): void {
    if (!this.arcCamera || !this.localPlayerRoot) return;
    const p = this.localPlayerRoot.position; // world-space (root has no parent)
    // Offset upward so the camera looks at shoulder height, not the feet.
    const t = this.arcCamera.target;
    const newX = p.x;
    const newY = p.y + 1.3;
    const newZ = p.z;
    const dx = newX - t.x;
    const dy = newY - t.y;
    const dz = newZ - t.z;
    // Move BOTH target and camera position by the same delta. The
    // orbit angle (alpha/beta/radius) is preserved by construction —
    // any drift between Babylon's internal state and the new target
    // is impossible because we don't touch alpha/beta directly.
    // Result: when the player walks, the camera follows at exactly
    // the same orbit the user set; movement initiation can never
    // perturb the view.
    t.x = newX; t.y = newY; t.z = newZ;
    const c = this.arcCamera.position;
    c.x += dx; c.y += dy; c.z += dz;
  }

}
