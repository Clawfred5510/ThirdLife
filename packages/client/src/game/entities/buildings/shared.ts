import {
  Scene,
  MeshBuilder,
  Mesh,
  Vector3,
  Color3,
  PBRMetallicRoughnessMaterial,
  TransformNode,
  AbstractMesh,
} from '@babylonjs/core';

/**
 * Shared foundation for per-type building modules.
 *
 * Responsibilities
 * - Scene-scoped PBR material cache keyed by (role, color, roughness,…)
 * - Common interior shell helper (floor, ceiling, 6-strip wall + doorway)
 * - BuildingOutput type contract + BuildingSpec type contract
 * - The list of roof meshes is populated by per-type builders as they
 *   place decorative pieces above the wall line.
 */

export type RoofType = 'dome' | 'flat' | 'gable' | 'sawtooth' | 'pyramid' | 'mansard';

export interface BuildingSpec {
  /** Footprint is the SLOT the building+composition occupies on the lot
   *  — up to ~36u on a 40u cell. Main building is typically smaller. */
  footprint: number;
  footprintZ?: number;
  /** Main structure wall height above floor. */
  wallHeight: number;
  /** Roof peak height above the wall-top line (for gable/pyramid). */
  roofPeak: number;
  wallThickness: number;
  doorWidth: number;
  doorHeight: number;
  wallColor: string;
  roofColor: string;
  trimColor: string;
  roofType?: RoofType;
}

export interface BuildingOutput {
  root: TransformNode;
  exteriorCasters: AbstractMesh[];
  collisionWalls: AbstractMesh[];
  /** Roof + decorative pieces that should fade when the player is inside. */
  roofMeshes: AbstractMesh[];
  centerXZ: [number, number];
  halfExtentsXZ: [number, number];
  /** Interior wall height — used by the tall-building wall-shrink effect
   *  when the player enters. Tall (>9u) buildings shrink the upper portion
   *  so the RuneScape-style camera doesn't look into a cavernous box. */
  interiorHeight: number;
}

// ── Material cache (per scene) ───────────────────────────────────────────
const materialCache = new WeakMap<Scene, Map<string, PBRMetallicRoughnessMaterial>>();

export interface MatOpts {
  metallic?: number;
  alpha?: number;
  emissive?: Color3;
}

export function hexToColor(hex: string): Color3 {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return new Color3(r, g, b);
}

export function mat(
  scene: Scene,
  role: string,
  color: string,
  roughness = 0.85,
  opts?: MatOpts,
): PBRMetallicRoughnessMaterial {
  let cache = materialCache.get(scene);
  if (!cache) {
    cache = new Map();
    materialCache.set(scene, cache);
  }
  const key = `${role}|${color}|${roughness}|${opts?.metallic ?? 0}|${opts?.alpha ?? 1}|${opts?.emissive?.toHexString() ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const m = new PBRMetallicRoughnessMaterial(`mat_${role}_${color}_${cache.size}`, scene);
  m.baseColor = hexToColor(color);
  m.metallic = opts?.metallic ?? 0;
  m.roughness = roughness;
  if (opts?.alpha !== undefined && opts.alpha < 1) m.alpha = opts.alpha;
  if (opts?.emissive) m.emissiveColor = opts.emissive;
  // Roof / trim / canopy / gable meshes use custom vertex data that may
  // be viewed from either side. Disable backface culling on those roles
  // so slopes don't vanish from unusual angles.
  if (/(roof|trim|canopy|eaves|gable|dome|awning|pediment|parapet|silo-cap|turret|penthouse)/i.test(role)) {
    m.backFaceCulling = false;
  }
  cache.set(key, m);
  return m;
}

/**
 * Name-based classifier for "this mesh should fade with the roof when the
 * player is inside." Per-type builders name their decor meshes by role
 * (roof_, dome_, silo_, stack_, chimney_, etc.), so pattern-match the name
 * instead of just the y-position (which missed low-slung elements like
 * porch canopies).
 */
const ROOF_MESH_PATTERNS = [
  /roof/i, /^gable_/, /^pyramid_/, /^sawtooth_/, /^dome_/, /^turret/i,
  /^silo/i, /^chimney/i, /^ridge/, /^stack/i, /^smokestack/i,
  /^cornice/i, /^parapet/, /^eaves/, /^canopy/i, /^awning/i,
  /^hayWin/, /^spire/, /^towerBase/, /^clock/i, /^hourHand/, /^minHand/,
  /^pediment/, /^flagpole/, /^flag_/, /^wt(Drum|Cap|DrumTop|Leg)/,
  /^pipe_/, /^extPipe/, /^puff/, /^steam/,
  /^hf(Leg|Cross|Wheel)/, // mine headframe
  /^bankCornice/, /^bankLantern/, /^bankLantTop/, /^aptPar/, /^aptCornice/,
  /^aptAC/, /^penthouse/, /^dishBase/, /^dish_/, /^officeRoof/,
  /^bladeSign/, /^shopSign/, /^shopRoof/, /^shopAwning/,
  /^mkCanopy/, /^mkPole/, /^mkPennant/, /^mkBulb/,
  /^corrug/, /^stackCap/, /^officeEntry/, /^entab/,
  /^flat/i, /^slab/i,
];
export function isRoofMesh(name: string): boolean {
  return ROOF_MESH_PATTERNS.some((p) => p.test(name));
}

// ── Interior shell helper ────────────────────────────────────────────────
// Returns the ceiling + walls for tracking. Caller adds type-specific
// decor and the returned pieces go into the exterior caster + collision
// lists. Note: `roofMeshes` in the final BuildingOutput also includes the
// ceiling so it fades when the player is inside.

export interface ShellOutput {
  floor: Mesh;
  ceiling: Mesh;
  wallsAdded: number; // count of walls pushed to casters+collisions
}

export function buildInteriorShell(
  scene: Scene,
  id: string | number,
  root: TransformNode,
  spec: BuildingSpec,
  footprintW: number,
  footprintD: number,
  exteriorCasters: AbstractMesh[],
  collisionWalls: AbstractMesh[],
  wallMat: PBRMetallicRoughnessMaterial,
  trimMat: PBRMetallicRoughnessMaterial,
): ShellOutput {
  const halfW = footprintW / 2;
  const halfD = footprintD / 2;
  const innerHalfW = halfW - spec.wallThickness;
  const innerHalfD = halfD - spec.wallThickness;
  const wallH = spec.wallHeight;
  const doorW = spec.doorWidth;
  const doorH = spec.doorHeight;
  const innerWidth = footprintW - spec.wallThickness * 2;
  const sideWidth = (innerWidth - doorW) / 2;
  const lintelH = wallH - doorH;

  const floorMat = mat(scene, 'floor', '#8c6a48', 0.85);
  const interiorMat = mat(scene, 'interior', '#f0e8d8', 0.95);

  const floor = MeshBuilder.CreateBox(`floor_${id}`, {
    width: innerHalfW * 2, height: 0.1, depth: innerHalfD * 2,
  }, scene);
  floor.parent = root;
  floor.position.y = 0.05;
  floor.material = floorMat;
  floor.receiveShadows = true;

  const ceiling = MeshBuilder.CreateBox(`ceiling_${id}`, {
    width: innerHalfW * 2, height: 0.1, depth: innerHalfD * 2,
  }, scene);
  ceiling.parent = root;
  ceiling.position.y = wallH - 0.05;
  ceiling.material = interiorMat;

  const countBefore = exteriorCasters.length;
  const addWall = (
    name: string, width: number, height: number, depth: number,
    px: number, py: number, pz: number,
  ) => {
    const m = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    m.parent = root;
    m.position.set(px, py, pz);
    m.material = wallMat;
    m.receiveShadows = true;
    m.checkCollisions = true;
    exteriorCasters.push(m);
    collisionWalls.push(m);
  };

  addWall(`wallL_${id}`, spec.wallThickness, wallH, footprintD, -halfW + spec.wallThickness / 2, wallH / 2, 0);
  addWall(`wallR_${id}`, spec.wallThickness, wallH, footprintD, halfW - spec.wallThickness / 2, wallH / 2, 0);
  addWall(`wallB_${id}`, footprintW - spec.wallThickness * 2, wallH, spec.wallThickness, 0, wallH / 2, halfD - spec.wallThickness / 2);
  addWall(`jambL_${id}`, sideWidth, wallH, spec.wallThickness, -doorW / 2 - sideWidth / 2, wallH / 2, -halfD + spec.wallThickness / 2);
  addWall(`jambR_${id}`, sideWidth, wallH, spec.wallThickness, doorW / 2 + sideWidth / 2, wallH / 2, -halfD + spec.wallThickness / 2);
  addWall(`lintel_${id}`, doorW, lintelH, spec.wallThickness, 0, doorH + lintelH / 2, -halfD + spec.wallThickness / 2);

  const frameTop = MeshBuilder.CreateBox(`frameTop_${id}`, {
    width: doorW + 0.5, height: 0.25, depth: spec.wallThickness * 1.2,
  }, scene);
  frameTop.parent = root;
  frameTop.position.set(0, doorH + 0.05, -halfD + spec.wallThickness / 2);
  frameTop.material = trimMat;
  frameTop.receiveShadows = true;

  return { floor, ceiling, wallsAdded: exteriorCasters.length - countBefore };
}

// ── Common simple props (reused across types) ────────────────────────────

export function buildMailbox(scene: Scene, id: string, parent: TransformNode, x: number, z: number, trimMat: PBRMetallicRoughnessMaterial) {
  const postM = MeshBuilder.CreateBox(`mbPost_${id}`, { width: 0.15, height: 1.1, depth: 0.15 }, scene);
  postM.parent = parent;
  postM.position.set(x, 0.55, z);
  postM.material = trimMat;
  const box = MeshBuilder.CreateBox(`mbBox_${id}`, { width: 0.5, height: 0.32, depth: 0.3 }, scene);
  box.parent = parent;
  box.position.set(x, 1.15, z);
  box.material = trimMat;
}

/** Four fence posts + three horizontal rails between consecutive posts. */
export function buildFenceRun(
  scene: Scene,
  id: string,
  parent: TransformNode,
  startX: number, startZ: number,
  endX: number, endZ: number,
  height: number,
  mat_: PBRMetallicRoughnessMaterial,
) {
  const dx = endX - startX, dz = endZ - startZ;
  const len = Math.hypot(dx, dz);
  const stepLen = 1.6; // post every 1.6u
  const n = Math.max(2, Math.round(len / stepLen));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = startX + dx * t;
    const pz = startZ + dz * t;
    const postM = MeshBuilder.CreateBox(`f_${id}_p${i}`, { width: 0.12, height, depth: 0.12 }, scene);
    postM.parent = parent;
    postM.position.set(px, height / 2, pz);
    postM.material = mat_;
  }
  // Top rail
  const rail = MeshBuilder.CreateBox(`f_${id}_rail`, { width: len, height: 0.08, depth: 0.08 }, scene);
  rail.parent = parent;
  rail.position.set((startX + endX) / 2, height * 0.85, (startZ + endZ) / 2);
  rail.rotation.y = -Math.atan2(dz, dx);
  rail.material = mat_;
}
