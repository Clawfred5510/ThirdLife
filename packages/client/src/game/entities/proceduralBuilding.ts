import {
  Scene,
  MeshBuilder,
  Mesh,
  Vector3,
  Color3,
  Color4,
  PBRMetallicRoughnessMaterial,
  TransformNode,
  AbstractMesh,
} from '@babylonjs/core';
import { buildFurniture } from './buildingFurniture';
import { buildFarm } from './buildings/farm';
import { buildHouse } from './buildings/house';

/**
 * Procedural building generator with per-type signature silhouettes.
 *
 * Each type gets one unmistakable element (silos, sawtooth roof, columns,
 * dome, smokestack, blade sign, etc.) per the art-director spec at
 * design/art/building-silhouettes-2026-04-24.md. The shared shell (floor,
 * walls, doorway, interior) stays the same; the roof + decorative anchors
 * differ.
 *
 * Materials are cloned per type from a small palette of shared bases —
 * roughly 6 shared mats per scene rather than 6 per building.
 */

export type RoofType = 'dome' | 'flat' | 'gable' | 'sawtooth' | 'pyramid' | 'mansard';
export type TowerRole = 'column' | 'silo' | 'smokestack' | 'turret' | 'none';
export type SignageStyle = 'awning' | 'blade' | 'marquee' | 'none';

export interface BuildingSpec {
  footprint: number;           // square footprint side length, world units
  footprintZ?: number;         // override for non-square (depth)
  wallHeight: number;
  roofPeak: number;            // height of roof element above the wall top
  wallThickness: number;
  doorWidth: number;
  doorHeight: number;
  wallColor: string;
  roofColor: string;
  trimColor: string;

  // Extended fields (optional, default to safe values)
  roofType?: RoofType;
  towerCount?: number;
  towerRole?: TowerRole;
  signageStyle?: SignageStyle;
  chimneyCount?: number;
  hasParapet?: boolean;
  hasSkylight?: boolean;
  hasCornerPosts?: boolean;    // legacy detail; off by default per art bible
}

export interface BuildingOutput {
  root: TransformNode;
  exteriorCasters: AbstractMesh[];
  collisionWalls: AbstractMesh[];
  /** Roof + decorative pieces that should fade when the player is inside.
   *  The walls themselves never fade — otherwise the player wouldn't see
   *  the interior walls around them. */
  roofMeshes: AbstractMesh[];
  /** World-space center and half-extents of the building footprint — used
   *  for the interior-containment check in MainScene's per-frame fader. */
  centerXZ: [number, number];
  halfExtentsXZ: [number, number];
}

const hexToColor = (hex: string): Color3 => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return new Color3(r, g, b);
};

// ── Shared materials cache (per scene) ───────────────────────────────────
// One PBR material per (scene, role, color) tuple. Bumps the scene's PBR
// material count from ~80 down to ~30 even with all 10 building types
// present; reduces draw-call cost and GPU memory.
interface MaterialKey { scene: Scene; role: string; color: string; }
const materialCache = new WeakMap<Scene, Map<string, PBRMetallicRoughnessMaterial>>();

function sharedMat(scene: Scene, role: string, color: string, roughness = 0.85, opts?: {
  metallic?: number; alpha?: number; emissive?: Color3;
}): PBRMetallicRoughnessMaterial {
  let cache = materialCache.get(scene);
  if (!cache) { cache = new Map(); materialCache.set(scene, cache); }
  const key = `${role}|${color}|${roughness}|${opts?.metallic ?? 0}|${opts?.alpha ?? 1}|${opts?.emissive?.toHexString() ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const m = new PBRMetallicRoughnessMaterial(`mat_${role}_${color}_${cache.size}`, scene);
  m.baseColor = hexToColor(color);
  m.metallic = opts?.metallic ?? 0;
  m.roughness = roughness;
  if (opts?.alpha !== undefined && opts.alpha < 1) m.alpha = opts.alpha;
  if (opts?.emissive) m.emissiveColor = opts.emissive;
  cache.set(key, m);
  return m;
}

/**
 * Build the exterior + interior of a building at world position. The
 * caller is responsible for parenting the returned root and registering
 * casters/collisions with the scene's shadow generator + collision system.
 */
export function buildProceduralBuilding(
  scene: Scene,
  id: string | number,
  position: Vector3,
  spec: BuildingSpec,
  buildingType: string = 'apartment',
): BuildingOutput {
  // Route to per-type modules where we've rebuilt them; the rest fall
  // through to the monolithic builder below.
  if (buildingType === 'farm') return buildFarm(scene, id, position, spec);
  if (buildingType === 'house') return buildHouse(scene, id, position, spec);

  const root = new TransformNode(`procBuilding_${id}`, scene);
  root.position.copyFrom(position);

  const w = spec.footprint;
  const d = spec.footprintZ ?? spec.footprint;
  const halfW = w / 2;
  const halfD = d / 2;
  const innerHalfW = halfW - spec.wallThickness;
  const innerHalfD = halfD - spec.wallThickness;
  const wallH = spec.wallHeight;
  const doorW = spec.doorWidth;
  const doorH = spec.doorHeight;

  const wallMat = sharedMat(scene, 'wall', spec.wallColor, 0.9);
  const roofMat = sharedMat(scene, 'roof', spec.roofColor, 0.7);
  const trimMat = sharedMat(scene, 'trim', spec.trimColor, 0.55);
  const interiorMat = sharedMat(scene, 'interior', '#f0e8d8', 0.95);
  const floorMat = sharedMat(scene, 'floor', '#8c6a48', 0.85);
  const glassMat = sharedMat(scene, 'glass', '#dceaf2', 0.15, {
    metallic: 0.1, alpha: 0.55, emissive: hexToColor('#dceaf2'),
  });
  const winFrameMat = sharedMat(scene, 'winframe', spec.trimColor, 0.6);

  const exteriorCasters: AbstractMesh[] = [];
  const collisionWalls: AbstractMesh[] = [];

  // ── Floor + ceiling ───────────────────────────────────────────────────
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

  // ── Walls (5 strips: L, R, B, jambL, jambR, lintel for front door) ────
  const innerWidth = w - spec.wallThickness * 2;
  const sideWidth = (innerWidth - doorW) / 2;
  const lintelH = wallH - doorH;

  const addWall = (
    name: string,
    width: number, height: number, depth: number,
    px: number, py: number, pz: number,
  ): Mesh => {
    const m = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    m.parent = root;
    m.position.set(px, py, pz);
    m.material = wallMat;
    m.receiveShadows = true;
    m.checkCollisions = true;
    exteriorCasters.push(m);
    collisionWalls.push(m);
    return m;
  };

  addWall(`wallL_${id}`, spec.wallThickness, wallH, d, -halfW + spec.wallThickness / 2, wallH / 2, 0);
  addWall(`wallR_${id}`, spec.wallThickness, wallH, d, halfW - spec.wallThickness / 2, wallH / 2, 0);
  addWall(`wallB_${id}`, w - spec.wallThickness * 2, wallH, spec.wallThickness, 0, wallH / 2, halfD - spec.wallThickness / 2);
  addWall(`jambL_${id}`, sideWidth, wallH, spec.wallThickness, -doorW / 2 - sideWidth / 2, wallH / 2, -halfD + spec.wallThickness / 2);
  addWall(`jambR_${id}`, sideWidth, wallH, spec.wallThickness, doorW / 2 + sideWidth / 2, wallH / 2, -halfD + spec.wallThickness / 2);
  addWall(`lintel_${id}`, doorW, lintelH, spec.wallThickness, 0, doorH + lintelH / 2, -halfD + spec.wallThickness / 2);

  // Door frame trim — top + 2 side strips + a small step
  const frameTop = MeshBuilder.CreateBox(`frameTop_${id}`, {
    width: doorW + 0.5, height: 0.25, depth: spec.wallThickness * 1.2,
  }, scene);
  frameTop.parent = root;
  frameTop.position.set(0, doorH + 0.05, -halfD + spec.wallThickness / 2);
  frameTop.material = trimMat;
  frameTop.receiveShadows = true;

  // Track which casters are walls so we can subtract them when collecting
  // roof meshes (roof = everything above the wall line).
  const wallOnlyCount = exteriorCasters.length;

  // ── Type-specific silhouette dispatch ─────────────────────────────────
  buildExteriorForType(scene, id, root, buildingType, spec, exteriorCasters, {
    halfW, halfD, wallH, w, d,
    wallMat, roofMat, trimMat, glassMat, winFrameMat,
  });

  // Everything the per-type builder added counts as roof/decoration.
  const roofMeshes: AbstractMesh[] = exteriorCasters.slice(wallOnlyCount);
  // Ceiling also fades (it's part of what blocks the top-down view).
  roofMeshes.push(ceiling);

  // ── Per-face windows (skip front for shop/farm/market — their facades
  // ── are dominated by display windows / barn door / open canopy)
  if (!['shop', 'farm', 'market'].includes(buildingType)) {
    addStandardWindows(scene, id, root, spec, halfW, halfD, wallH, doorW, sideWidth, glassMat, winFrameMat);
  }

  // ── Interior furniture per type ──────────────────────────────────────
  const furniture = buildFurniture(scene, id, buildingType, Math.min(innerHalfW, innerHalfD) * 2, wallH);
  furniture.root.parent = root;

  return {
    root,
    exteriorCasters,
    collisionWalls,
    roofMeshes,
    centerXZ: [position.x, position.z],
    halfExtentsXZ: [halfW, halfD],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Per-type signature element builders
// ─────────────────────────────────────────────────────────────────────────

interface ExtCtx {
  halfW: number; halfD: number; wallH: number; w: number; d: number;
  wallMat: PBRMetallicRoughnessMaterial;
  roofMat: PBRMetallicRoughnessMaterial;
  trimMat: PBRMetallicRoughnessMaterial;
  glassMat: PBRMetallicRoughnessMaterial;
  winFrameMat: PBRMetallicRoughnessMaterial;
}

function buildExteriorForType(
  scene: Scene,
  id: string | number,
  root: TransformNode,
  type: string,
  spec: BuildingSpec,
  casters: AbstractMesh[],
  ctx: ExtCtx,
): void {
  const { halfW, halfD, wallH, w, d, wallMat, roofMat, trimMat } = ctx;
  const cap = (m: Mesh) => {
    m.parent = root; m.receiveShadows = true; casters.push(m);
  };

  switch (type) {
    case 'apartment': addApartment(scene, id, root, spec, casters, ctx); return;
    case 'house':     addHouse(scene, id, root, spec, casters, ctx); return;
    case 'shop':      addShop(scene, id, root, spec, casters, ctx); return;
    case 'farm':      addFarm(scene, id, root, spec, casters, ctx); return;
    case 'market':    addMarket(scene, id, root, spec, casters, ctx); return;
    case 'office':    addOffice(scene, id, root, spec, casters, ctx); return;
    case 'mine':      addMine(scene, id, root, spec, casters, ctx); return;
    case 'hall':      addHall(scene, id, root, spec, casters, ctx); return;
    case 'factory':   addFactory(scene, id, root, spec, casters, ctx); return;
    case 'bank':      addBank(scene, id, root, spec, casters, ctx); return;
    default: {
      // Generic flat-roof fallback
      const slab = MeshBuilder.CreateBox(`slab_${id}`, { width: w + 0.4, height: 0.5, depth: d + 0.4 }, scene);
      slab.position.y = wallH + 0.25;
      slab.material = roofMat;
      cap(slab);
    }
  }
}

// Helper: standard parapet rim around a flat roof
function addParapet(scene: Scene, id: string | number, root: TransformNode, w: number, d: number, atY: number, mat: PBRMetallicRoughnessMaterial, casters: AbstractMesh[]) {
  const t = 0.4, h = 0.6;
  const pieces: Array<{ pw: number; pd: number; px: number; pz: number }> = [
    { pw: w + 0.4 + t * 2, pd: t, px: 0, pz: d / 2 + 0.2 },
    { pw: w + 0.4 + t * 2, pd: t, px: 0, pz: -d / 2 - 0.2 },
    { pw: t,               pd: d + 0.4, px: w / 2 + 0.2, pz: 0 },
    { pw: t,               pd: d + 0.4, px: -w / 2 - 0.2, pz: 0 },
  ];
  for (const { pw, pd, px, pz } of pieces) {
    const m = MeshBuilder.CreateBox(`parapet_${id}_${px}_${pz}`, { width: pw, height: h, depth: pd }, scene);
    m.parent = root;
    m.position.set(px, atY + h / 2, pz);
    m.material = mat;
    m.receiveShadows = true;
    casters.push(m);
  }
}

// Helper: flat slab roof (for types with flat roofs)
function addFlatRoof(scene: Scene, id: string | number, root: TransformNode, w: number, d: number, atY: number, mat: PBRMetallicRoughnessMaterial, casters: AbstractMesh[], overhang = 0.4) {
  const slab = MeshBuilder.CreateBox(`flatRoof_${id}`, { width: w + overhang * 2, height: 0.3, depth: d + overhang * 2 }, scene);
  slab.parent = root;
  slab.position.y = atY + 0.15;
  slab.material = mat;
  slab.receiveShadows = true;
  casters.push(slab);
}

// Helper: gable roof (two triangular wedges meeting at the ridge)
function addGableRoof(scene: Scene, id: string | number, root: TransformNode, w: number, d: number, atY: number, peak: number, mat: PBRMetallicRoughnessMaterial, casters: AbstractMesh[]) {
  // Two 4-sided cylinders form a triangular prism along x axis
  // Easier: make a single triangular prism via a Box scaled and rotated, plus end caps
  // Use a CreateCylinder with 3 sides isn't quite right. Simplest: two box wedges.
  // Hack: a Cylinder(diameterTop=0, diameterBottom=peak*2, height=w, tessellation=3) lying on its side gives a true triangular prism.
  const prism = MeshBuilder.CreateCylinder(`gable_${id}`, {
    diameterTop: 0,
    diameterBottom: peak * 2,
    height: w + 0.6,
    tessellation: 3,
  }, scene);
  prism.parent = root;
  prism.rotation.z = Math.PI / 2;       // Lay it on its side along x
  prism.rotation.x = Math.PI / 6;       // Rotate so flat face is down
  prism.scaling.set(1, d / (w + 0.6) * 1.05, 1);  // Stretch along z to cover depth
  prism.position.y = atY + peak / 2;
  prism.material = mat;
  prism.receiveShadows = true;
  casters.push(prism);
}

// Helper: pyramid roof (4-sided cone)
function addPyramidRoof(scene: Scene, id: string | number, root: TransformNode, w: number, d: number, atY: number, peak: number, mat: PBRMetallicRoughnessMaterial, casters: AbstractMesh[]) {
  const pyr = MeshBuilder.CreateCylinder(`pyramid_${id}`, {
    diameterTop: 0, diameterBottom: Math.max(w, d) + 0.6, height: peak, tessellation: 4,
  }, scene);
  pyr.parent = root;
  pyr.rotation.y = Math.PI / 4;
  pyr.position.y = atY + peak / 2;
  pyr.scaling.x = w / Math.max(w, d);
  pyr.scaling.z = d / Math.max(w, d);
  pyr.material = mat;
  pyr.receiveShadows = true;
  casters.push(pyr);
}

// Helper: chimney
function addChimney(scene: Scene, id: string | number, root: TransformNode, x: number, z: number, baseY: number, h: number, mat: PBRMetallicRoughnessMaterial, casters: AbstractMesh[]) {
  const c = MeshBuilder.CreateBox(`chimney_${id}_${x}_${z}`, { width: 0.9, height: h, depth: 0.9 }, scene);
  c.parent = root;
  c.position.set(x, baseY + h / 2, z);
  c.material = mat;
  c.receiveShadows = true;
  casters.push(c);
}

// ── Type implementations ────────────────────────────────────────────────

function addApartment(scene: Scene, id: string | number, root: TransformNode, spec: BuildingSpec, casters: AbstractMesh[], ctx: ExtCtx) {
  const { halfW, halfD, wallH, w, d, roofMat, trimMat } = ctx;
  // Mid-height cornice band
  const cornice = MeshBuilder.CreateBox(`cornice_${id}`, { width: w + 0.3, height: 0.4, depth: d + 0.3 }, scene);
  cornice.parent = root;
  cornice.position.y = wallH * 0.55;
  cornice.material = trimMat;
  cornice.receiveShadows = true;
  casters.push(cornice);

  // Flat roof + parapet
  addFlatRoof(scene, id, root, w, d, wallH, roofMat, casters);
  addParapet(scene, id, root, w, d, wallH + 0.3, trimMat, casters);

  // Water tower on back-left
  const towerBase = MeshBuilder.CreateBox(`watTwrBase_${id}`, { width: 1.2, height: 1.0, depth: 1.2 }, scene);
  towerBase.parent = root;
  towerBase.position.set(-halfW * 0.4, wallH + 0.8, halfD * 0.4);
  towerBase.material = trimMat;
  towerBase.receiveShadows = true;
  casters.push(towerBase);
  const tank = MeshBuilder.CreateCylinder(`watTwr_${id}`, { diameter: 2.4, height: 3.0, tessellation: 16 }, scene);
  tank.parent = root;
  tank.position.set(-halfW * 0.4, wallH + 2.8, halfD * 0.4);
  tank.material = sharedMat(scene, 'metal-cool', '#7A8090', 0.5, { metallic: 0.6 });
  tank.receiveShadows = true;
  casters.push(tank);
  const tankCap = MeshBuilder.CreateSphere(`watCap_${id}`, { diameter: 2.4, segments: 12 }, scene);
  tankCap.parent = root;
  tankCap.position.set(-halfW * 0.4, wallH + 4.3, halfD * 0.4);
  tankCap.scaling.y = 0.4;
  tankCap.material = sharedMat(scene, 'metal-cool', '#7A8090', 0.5, { metallic: 0.6 });
  casters.push(tankCap);

  // Balcony ledges at floor-2 level (mid-height)
  const ledgeY = wallH * 0.58;
  for (const side of [-1, 1]) {
    const ledge = MeshBuilder.CreateBox(`ledge_${id}_${side}`, { width: w * 0.7, height: 0.15, depth: 0.7 }, scene);
    ledge.parent = root;
    ledge.position.set(0, ledgeY, side * (halfD + 0.3));
    ledge.material = trimMat;
    casters.push(ledge);
  }
}

function addHouse(scene: Scene, id: string | number, root: TransformNode, spec: BuildingSpec, casters: AbstractMesh[], ctx: ExtCtx) {
  const { halfW, halfD, wallH, w, d, roofMat, trimMat } = ctx;
  // Steep gable roof
  addGableRoof(scene, id, root, w, d, wallH, spec.roofPeak, roofMat, casters);

  // Front porch — shallow platform with two flanking columns
  const porchDepth = 1.5;
  const porch = MeshBuilder.CreateBox(`porch_${id}`, { width: spec.doorWidth + 2.4, height: 0.3, depth: porchDepth }, scene);
  porch.parent = root;
  porch.position.set(0, 0.2, -halfD - porchDepth / 2);
  porch.material = sharedMat(scene, 'concrete', '#B0AA8E', 0.8);
  porch.receiveShadows = true;
  casters.push(porch);
  for (const cx of [-(spec.doorWidth / 2 + 0.8), (spec.doorWidth / 2 + 0.8)]) {
    const col = MeshBuilder.CreateCylinder(`porchCol_${id}_${cx}`, { diameter: 0.6, height: spec.doorHeight, tessellation: 12 }, scene);
    col.parent = root;
    col.position.set(cx, spec.doorHeight / 2 + 0.3, -halfD - porchDepth + 0.4);
    col.material = trimMat;
    casters.push(col);
  }
  // Porch overhang/canopy
  const canopy = MeshBuilder.CreateBox(`porchTop_${id}`, { width: spec.doorWidth + 3, height: 0.2, depth: porchDepth + 0.4 }, scene);
  canopy.parent = root;
  canopy.position.set(0, spec.doorHeight + 0.4, -halfD - porchDepth / 2 + 0.2);
  canopy.material = roofMat;
  casters.push(canopy);

  // Single chimney on rear-left
  addChimney(scene, id, root, -halfW * 0.5, halfD * 0.5, wallH + spec.roofPeak * 0.4, 1.6, trimMat, casters);
}

function addShop(scene: Scene, id: string | number, root: TransformNode, spec: BuildingSpec, casters: AbstractMesh[], ctx: ExtCtx) {
  const { halfW, halfD, wallH, w, d, roofMat, trimMat, glassMat, winFrameMat } = ctx;
  // Flat roof
  addFlatRoof(scene, id, root, w, d, wallH, roofMat, casters, 0.2);

  // Blade sign — vertical box projecting above the roofline
  const sign = MeshBuilder.CreateBox(`bladeSign_${id}`, { width: w * 0.9, height: 2.5, depth: 0.4 }, scene);
  sign.parent = root;
  sign.position.set(0, wallH + 1.65, -halfD - 0.3);
  sign.material = sharedMat(scene, 'sign', spec.roofColor, 0.6, { emissive: hexToColor(spec.roofColor).scale(0.18) });
  sign.receiveShadows = true;
  casters.push(sign);

  // Broad front awning, striped (3 box stripes alternating wall/trim color)
  const awningDepth = 2.4;
  for (let i = 0; i < 3; i++) {
    const stripe = MeshBuilder.CreateBox(`awningStripe_${id}_${i}`, { width: w * 0.9, height: 0.18, depth: awningDepth / 3 }, scene);
    stripe.parent = root;
    stripe.position.set(0, spec.doorHeight + 0.6, -halfD - awningDepth / 2 + i * (awningDepth / 3) + (awningDepth / 6));
    stripe.material = i % 2 === 0 ? sharedMat(scene, 'awning-a', '#F5C842', 0.5) : sharedMat(scene, 'awning-b', spec.roofColor, 0.5);
    stripe.receiveShadows = true;
    casters.push(stripe);
  }

  // Big front display windows (one per side of door)
  const frontWinH = wallH * 0.55;
  const frontWinY = spec.doorHeight * 0.55;
  for (const xSign of [-1, 1]) {
    const xCenter = xSign * (spec.doorWidth / 2 + (w - spec.doorWidth) / 4);
    const winW = (w - spec.doorWidth - spec.wallThickness * 2) / 2 - 0.8;
    const frame = MeshBuilder.CreateBox(`shopWinFr_${id}_${xSign}`, { width: winW + 0.3, height: frontWinH + 0.3, depth: spec.wallThickness * 1.05 }, scene);
    frame.parent = root;
    frame.position.set(xCenter, frontWinY, -halfD + spec.wallThickness / 2);
    frame.material = winFrameMat;
    casters.push(frame);
    const glass = MeshBuilder.CreateBox(`shopWin_${id}_${xSign}`, { width: winW, height: frontWinH, depth: spec.wallThickness * 0.5 }, scene);
    glass.parent = frame;
    glass.material = glassMat;
  }
}

function addFarm(scene: Scene, id: string | number, root: TransformNode, spec: BuildingSpec, casters: AbstractMesh[], ctx: ExtCtx) {
  const { halfW, halfD, wallH, w, d, roofMat, trimMat } = ctx;
  // Gable roof on the main barn body
  addGableRoof(scene, id, root, w, d, wallH, spec.roofPeak, roofMat, casters);

  // Two silos on the right side, rising well above the barn
  const siloDiam = 3.0;
  const siloH = 10;
  for (let i = 0; i < 2; i++) {
    const sx = halfW + siloDiam * 0.6 + i * (siloDiam + 0.4);
    const silo = MeshBuilder.CreateCylinder(`silo_${id}_${i}`, { diameter: siloDiam, height: siloH, tessellation: 18 }, scene);
    silo.parent = root;
    silo.position.set(sx, siloH / 2, halfD * 0.3);
    silo.material = sharedMat(scene, 'silo', '#D8C9A8', 0.85);
    silo.receiveShadows = true;
    casters.push(silo);
    const cap = MeshBuilder.CreateSphere(`siloCap_${id}_${i}`, { diameter: siloDiam, segments: 14 }, scene);
    cap.parent = root;
    cap.position.set(sx, siloH + 0.05, halfD * 0.3);
    cap.scaling.y = 0.5;
    cap.material = sharedMat(scene, 'silo-cap', '#7A8090', 0.5, { metallic: 0.5 });
    casters.push(cap);
  }

  // Horizontal board lines on facade — thin trim stripes at every 1.5u
  for (let y = 1.5; y < wallH; y += 1.5) {
    const line = MeshBuilder.CreateBox(`board_${id}_${y}`, { width: w + 0.05, height: 0.12, depth: d + 0.05 }, scene);
    line.parent = root;
    line.position.y = y;
    line.material = sharedMat(scene, 'board', '#7A5030', 0.85);
    casters.push(line);
  }
}

function addMarket(scene: Scene, id: string | number, root: TransformNode, spec: BuildingSpec, casters: AbstractMesh[], ctx: ExtCtx) {
  const { halfW, halfD, wallH, w, d, roofMat, trimMat, glassMat } = ctx;
  // Flat shed roof
  addFlatRoof(scene, id, root, w, d, wallH, roofMat, casters, 0.4);

  // Wide canopy overhang on 4 cylinder pillars in front
  const canopyW = w + 1.2;
  const canopyD = 4.5;
  const canopy = MeshBuilder.CreateBox(`marketCanopy_${id}`, { width: canopyW, height: 0.35, depth: canopyD }, scene);
  canopy.parent = root;
  canopy.position.set(0, wallH * 0.85, -halfD - canopyD / 2 + 0.4);
  canopy.material = sharedMat(scene, 'market-canopy', spec.roofColor, 0.7);
  canopy.receiveShadows = true;
  casters.push(canopy);

  for (let i = 0; i < 4; i++) {
    const px = -halfW + 1 + i * (w - 2) / 3;
    const pillar = MeshBuilder.CreateCylinder(`pillar_${id}_${i}`, { diameter: 0.7, height: wallH * 0.85, tessellation: 12 }, scene);
    pillar.parent = root;
    pillar.position.set(px, wallH * 0.425, -halfD - canopyD + 0.6);
    pillar.material = sharedMat(scene, 'pillar-white', '#EDE9DE', 0.7);
    casters.push(pillar);
  }

  // String of small "light bulb" spheres along canopy front edge
  const bulbMat = sharedMat(scene, 'bulb', '#F5C842', 0.2, { emissive: hexToColor('#F5C842').scale(0.6) });
  for (let i = 0; i < 8; i++) {
    const bx = -canopyW / 2 + (canopyW / 7) * i;
    const bulb = MeshBuilder.CreateSphere(`bulb_${id}_${i}`, { diameter: 0.25, segments: 8 }, scene);
    bulb.parent = root;
    bulb.position.set(bx, wallH * 0.85 - 0.2, -halfD - canopyD + 0.4);
    bulb.material = bulbMat;
  }
}

function addOffice(scene: Scene, id: string | number, root: TransformNode, spec: BuildingSpec, casters: AbstractMesh[], ctx: ExtCtx) {
  const { halfW, halfD, wallH, w, d, roofMat, trimMat, glassMat } = ctx;
  // Flat roof + parapet
  addFlatRoof(scene, id, root, w, d, wallH, roofMat, casters);
  addParapet(scene, id, root, w, d, wallH + 0.3, trimMat, casters);

  // Mid-height glass band
  const bandY = wallH * 0.55;
  const bandH = 1.0;
  for (const [bx, bz, bw, bd] of [
    [0, -halfD + spec.wallThickness * 0.3, w * 0.95, 0.15],
    [0, halfD - spec.wallThickness * 0.3, w * 0.95, 0.15],
    [-halfW + spec.wallThickness * 0.3, 0, 0.15, d * 0.95],
    [halfW - spec.wallThickness * 0.3, 0, 0.15, d * 0.95],
  ] as const) {
    const band = MeshBuilder.CreateBox(`glassBand_${id}_${bx}_${bz}`, { width: bw, height: bandH, depth: bd }, scene);
    band.parent = root;
    band.position.set(bx, bandY, bz);
    band.material = glassMat;
  }

  // Penthouse box on roof
  const penthouse = MeshBuilder.CreateBox(`penthouse_${id}`, { width: w * 0.45, height: 3, depth: d * 0.45 }, scene);
  penthouse.parent = root;
  penthouse.position.set(0, wallH + 1.7, halfD * 0.2);
  penthouse.material = sharedMat(scene, 'penthouse', '#5A5F6B', 0.7);
  penthouse.receiveShadows = true;
  casters.push(penthouse);

  // Cantilevered entry blade above door
  const entry = MeshBuilder.CreateBox(`officeEntry_${id}`, { width: 6, height: 0.2, depth: 1.6 }, scene);
  entry.parent = root;
  entry.position.set(0, spec.doorHeight + 0.4, -halfD - 0.6);
  entry.material = trimMat;
  casters.push(entry);
}

function addMine(scene: Scene, id: string | number, root: TransformNode, spec: BuildingSpec, casters: AbstractMesh[], ctx: ExtCtx) {
  const { halfW, halfD, wallH, w, d, roofMat, trimMat } = ctx;
  // Flat roof
  addFlatRoof(scene, id, root, w, d, wallH, roofMat, casters);

  // Massive single smokestack on back-right
  const stackDiam = 2.0;
  const stackH = 12;
  const stack = MeshBuilder.CreateCylinder(`smokestack_${id}`, { diameter: stackDiam, height: stackH, tessellation: 16 }, scene);
  stack.parent = root;
  stack.position.set(halfW * 0.55, wallH + stackH / 2, halfD * 0.55);
  stack.material = sharedMat(scene, 'metal-weather', '#7A8090', 0.55);
  stack.receiveShadows = true;
  casters.push(stack);
  // Stack cap rim
  const stackCap = MeshBuilder.CreateCylinder(`stackCap_${id}`, { diameter: stackDiam * 1.15, height: 0.4, tessellation: 16 }, scene);
  stackCap.parent = root;
  stackCap.position.set(halfW * 0.55, wallH + stackH + 0.2, halfD * 0.55);
  stackCap.material = sharedMat(scene, 'metal-weather', '#3A2418', 0.6);
  casters.push(stackCap);

  // Heavy timber cross-brace over the door (two diagonals)
  const braceL = MeshBuilder.CreateBox(`brace_${id}_l`, { width: spec.doorWidth + 1.5, height: 0.3, depth: 0.25 }, scene);
  braceL.parent = root;
  braceL.position.set(0, spec.doorHeight + 0.3, -halfD - 0.05);
  braceL.rotation.z = 0.3;
  braceL.material = sharedMat(scene, 'wood-dark', '#7A5030', 0.85);
  casters.push(braceL);
  const braceR = MeshBuilder.CreateBox(`brace_${id}_r`, { width: spec.doorWidth + 1.5, height: 0.3, depth: 0.25 }, scene);
  braceR.parent = root;
  braceR.position.set(0, spec.doorHeight + 0.3, -halfD - 0.05);
  braceR.rotation.z = -0.3;
  braceR.material = sharedMat(scene, 'wood-dark', '#7A5030', 0.85);
  casters.push(braceR);

  // Exterior pipe running up the front-left wall
  const pipe = MeshBuilder.CreateCylinder(`extPipe_${id}`, { diameter: 0.35, height: wallH, tessellation: 10 }, scene);
  pipe.parent = root;
  pipe.position.set(-halfW + 0.6, wallH / 2, -halfD - 0.15);
  pipe.material = sharedMat(scene, 'metal-rust', '#9A7858', 0.7);
  casters.push(pipe);
}

function addHall(scene: Scene, id: string | number, root: TransformNode, spec: BuildingSpec, casters: AbstractMesh[], ctx: ExtCtx) {
  const { halfW, halfD, wallH, w, d, roofMat, trimMat } = ctx;
  // Pyramid roof
  addPyramidRoof(scene, id, root, w, d, wallH, spec.roofPeak, roofMat, casters);

  // Four classical columns across the front, projecting forward
  const colDiam = 1.2;
  const colH = wallH;
  const projection = 1.0;
  for (let i = 0; i < 4; i++) {
    const cx = -w * 0.4 + (w * 0.8 / 3) * i;
    const col = MeshBuilder.CreateCylinder(`hallCol_${id}_${i}`, { diameter: colDiam, height: colH, tessellation: 18 }, scene);
    col.parent = root;
    col.position.set(cx, colH / 2, -halfD - projection);
    col.material = sharedMat(scene, 'pillar-white', '#EDE9DE', 0.7);
    col.receiveShadows = true;
    casters.push(col);
    // Capital
    const cap = MeshBuilder.CreateCylinder(`hallCap_${id}_${i}`, { diameter: colDiam * 1.4, height: 0.35, tessellation: 18 }, scene);
    cap.parent = root;
    cap.position.set(cx, colH - 0.18, -halfD - projection);
    cap.material = sharedMat(scene, 'pillar-white', '#EDE9DE', 0.7);
    casters.push(cap);
  }
  // Triangular pediment above columns (3-sided cylinder for the prism)
  const ped = MeshBuilder.CreateCylinder(`pediment_${id}`, { diameterTop: 0, diameterBottom: 2.0, height: w * 0.85, tessellation: 3 }, scene);
  ped.parent = root;
  ped.rotation.z = Math.PI / 2;
  ped.rotation.x = Math.PI / 6;
  ped.position.set(0, wallH + 0.6, -halfD - projection - 0.05);
  ped.scaling.set(1, 0.5, 1);
  ped.material = sharedMat(scene, 'pillar-white', '#EDE9DE', 0.7);
  casters.push(ped);
  // Wide entry steps
  for (let s = 0; s < 3; s++) {
    const step = MeshBuilder.CreateBox(`hallStep_${id}_${s}`, { width: w + 1, height: 0.3, depth: 1.4 - s * 0.3 }, scene);
    step.parent = root;
    step.position.set(0, 0.15 + s * 0.3, -halfD - projection - 1.5 + s * 0.3);
    step.material = sharedMat(scene, 'concrete', '#B0AA8E', 0.85);
    casters.push(step);
  }
  // Flagpole on peak
  const pole = MeshBuilder.CreateCylinder(`flagpole_${id}`, { diameter: 0.2, height: 4, tessellation: 8 }, scene);
  pole.parent = root;
  pole.position.set(0, wallH + spec.roofPeak + 2, 0);
  pole.material = sharedMat(scene, 'metal-cool', '#7A8090', 0.4, { metallic: 0.6 });
  casters.push(pole);
}

function addFactory(scene: Scene, id: string | number, root: TransformNode, spec: BuildingSpec, casters: AbstractMesh[], ctx: ExtCtx) {
  const { halfW, halfD, wallH, w, d, roofMat, trimMat, glassMat } = ctx;
  // Sawtooth roof — three north-light sheds
  const bays = 3;
  const bayDepth = d / bays;
  const sawHeight = 2.5;
  for (let i = 0; i < bays; i++) {
    const bayCenterZ = -halfD + bayDepth * (i + 0.5);
    // Sloped opaque face (south)
    const slope = MeshBuilder.CreateCylinder(`sawSlope_${id}_${i}`, {
      diameterTop: 0, diameterBottom: sawHeight * 2, height: w + 0.4, tessellation: 3,
    }, scene);
    slope.parent = root;
    slope.rotation.z = Math.PI / 2;
    slope.rotation.x = Math.PI / 6;
    slope.scaling.set(1, bayDepth / (w + 0.4), 1);
    slope.position.set(0, wallH + sawHeight / 2, bayCenterZ);
    slope.material = sharedMat(scene, 'metal-roof', spec.roofColor, 0.75);
    slope.receiveShadows = true;
    casters.push(slope);
    // Vertical glass face (north)
    const glassFace = MeshBuilder.CreateBox(`sawGlass_${id}_${i}`, { width: w + 0.3, height: sawHeight, depth: 0.2 }, scene);
    glassFace.parent = root;
    glassFace.position.set(0, wallH + sawHeight / 2, bayCenterZ + bayDepth * 0.3);
    glassFace.material = glassMat;
    casters.push(glassFace);
  }

  // Two smokestacks on left rear
  for (let i = 0; i < 2; i++) {
    const stack = MeshBuilder.CreateCylinder(`facStack_${id}_${i}`, { diameter: 1.2, height: 6, tessellation: 14 }, scene);
    stack.parent = root;
    stack.position.set(-halfW * 0.6, wallH + sawHeight + 3, halfD * 0.5 - i * 1.6);
    stack.material = sharedMat(scene, 'metal-dark', '#3A2418', 0.6);
    stack.receiveShadows = true;
    casters.push(stack);
  }

  // Loading dock platform on the right
  const dock = MeshBuilder.CreateBox(`dock_${id}`, { width: 1.4, height: 1.5, depth: d * 0.6 }, scene);
  dock.parent = root;
  dock.position.set(halfW + 0.7, 0.75, 0);
  dock.material = sharedMat(scene, 'concrete-dark', '#5A5F6B', 0.85);
  dock.receiveShadows = true;
  casters.push(dock);
}

function addBank(scene: Scene, id: string | number, root: TransformNode, spec: BuildingSpec, casters: AbstractMesh[], ctx: ExtCtx) {
  const { halfW, halfD, wallH, w, d, roofMat, trimMat } = ctx;
  // Flat base roof
  addFlatRoof(scene, id, root, w, d, wallH, roofMat, casters);
  // Cornice band trim at roofline
  const cornice = MeshBuilder.CreateBox(`bankCornice_${id}`, { width: w + 0.6, height: 0.45, depth: d + 0.6 }, scene);
  cornice.parent = root;
  cornice.position.y = wallH + 0.05;
  cornice.material = sharedMat(scene, 'gold-trim', '#F5C842', 0.4, { metallic: 0.4 });
  casters.push(cornice);

  // Central dome — half-sphere on roof center
  const domeDiam = w * 0.55;
  const dome = MeshBuilder.CreateSphere(`bankDome_${id}`, { diameter: domeDiam, segments: 24 }, scene);
  dome.parent = root;
  dome.position.y = wallH + 0.4;
  dome.scaling.y = 0.85;
  dome.material = sharedMat(scene, 'dome', '#C9A96E', 0.5, { metallic: 0.2 });
  dome.receiveShadows = true;
  casters.push(dome);

  // Two front corner turrets (cylinder + sphere cap)
  for (const tx of [-halfW * 0.85, halfW * 0.85]) {
    const turret = MeshBuilder.CreateCylinder(`turret_${id}_${tx}`, { diameter: 3.0, height: 3.0, tessellation: 16 }, scene);
    turret.parent = root;
    turret.position.set(tx, wallH + 1.5, -halfD - 0.4);
    turret.material = sharedMat(scene, 'pillar-white', '#EDE9DE', 0.7);
    casters.push(turret);
    const turretCap = MeshBuilder.CreateSphere(`turretCap_${id}_${tx}`, { diameter: 3.0, segments: 16 }, scene);
    turretCap.parent = root;
    turretCap.position.set(tx, wallH + 3.0, -halfD - 0.4);
    turretCap.scaling.y = 0.6;
    turretCap.material = sharedMat(scene, 'dome', '#C9A96E', 0.5, { metallic: 0.2 });
    casters.push(turretCap);
  }

  // Wide entry steps
  for (let s = 0; s < 3; s++) {
    const step = MeshBuilder.CreateBox(`bankStep_${id}_${s}`, { width: w * 0.6, height: 0.3, depth: 1.3 - s * 0.3 }, scene);
    step.parent = root;
    step.position.set(0, 0.15 + s * 0.3, -halfD - 1.4 + s * 0.3);
    step.material = sharedMat(scene, 'concrete', '#B0AA8E', 0.85);
    casters.push(step);
  }
}

// ── Standard windows on side + back faces ───────────────────────────────

function addStandardWindows(
  scene: Scene,
  id: string | number,
  root: TransformNode,
  spec: BuildingSpec,
  halfW: number, halfD: number, wallH: number, doorW: number, sideWidth: number,
  glassMat: PBRMetallicRoughnessMaterial,
  winFrameMat: PBRMetallicRoughnessMaterial,
) {
  const winW = Math.min(2.0, spec.footprint / 6);
  const winH_ = Math.min(1.8, wallH * 0.4);
  const winY = wallH * 0.55;
  const frameThickness = spec.wallThickness * 0.4;
  const glassDepth = spec.wallThickness * 0.6;

  const place = (face: 'L' | 'R' | 'B', offset: number) => {
    const wW = face === 'B' ? winW : glassDepth;
    const wH = winH_;
    const wD = face === 'B' ? glassDepth : winW;
    const frame = MeshBuilder.CreateBox(`winFr_${id}_${face}_${offset.toFixed(1)}`, {
      width: wW + (face === 'B' ? frameThickness * 2 : 0),
      height: wH + frameThickness * 2,
      depth: wD + (face === 'B' ? 0 : frameThickness * 2),
    }, scene);
    frame.parent = root;
    if (face === 'L') frame.position.set(-halfW + glassDepth / 2 - 0.001, winY, offset);
    else if (face === 'R') frame.position.set(halfW - glassDepth / 2 + 0.001, winY, offset);
    else frame.position.set(offset, winY, halfD - glassDepth / 2 + 0.001);
    frame.material = winFrameMat;
    frame.receiveShadows = true;
    const glass = MeshBuilder.CreateBox(`win_${id}_${face}_${offset.toFixed(1)}`, { width: wW, height: wH, depth: wD }, scene);
    glass.parent = frame;
    glass.material = glassMat;
  };

  const winSpacing = spec.footprint * 0.28;
  place('L', -winSpacing); place('L', winSpacing);
  place('R', -winSpacing); place('R', winSpacing);
  place('B', -winSpacing); place('B', winSpacing);
}

// ── BUILDING_SPECS — refreshed palette + per-type fields ────────────────

export const BUILDING_SPECS: Record<string, BuildingSpec> = {
  apartment: { footprint: 32, wallHeight: 11, roofPeak: 0.0, wallThickness: 0.5, doorWidth: 2.6, doorHeight: 3.2, wallColor: '#D8C9A8', roofColor: '#4A4E58', trimColor: '#EDE9DE', roofType: 'flat', hasParapet: true },
  house:     { footprint: 26, wallHeight: 6,  roofPeak: 5.0, wallThickness: 0.5, doorWidth: 2.4, doorHeight: 3.0, wallColor: '#EDE9DE', roofColor: '#B56B4A', trimColor: '#C9A96E', roofType: 'gable', chimneyCount: 1 },
  shop:      { footprint: 32, footprintZ: 24, wallHeight: 7,  roofPeak: 0.0, wallThickness: 0.5, doorWidth: 3.2, doorHeight: 3.0, wallColor: '#C9A96E', roofColor: '#B56B4A', trimColor: '#3A2418', roofType: 'flat', signageStyle: 'blade' },
  farm:      { footprint: 32, footprintZ: 28, wallHeight: 6,  roofPeak: 4.0, wallThickness: 0.5, doorWidth: 5.0, doorHeight: 3.5, wallColor: '#B56B4A', roofColor: '#3A2418', trimColor: '#7A5030', roofType: 'gable', towerCount: 2, towerRole: 'silo' },
  market:    { footprint: 36, footprintZ: 28, wallHeight: 7,  roofPeak: 0.0, wallThickness: 0.5, doorWidth: 4.0, doorHeight: 3.4, wallColor: '#C9A96E', roofColor: '#5A5F6B', trimColor: '#EDE9DE', roofType: 'flat', signageStyle: 'marquee' },
  office:    { footprint: 30, wallHeight: 13, roofPeak: 0.0, wallThickness: 0.5, doorWidth: 2.8, doorHeight: 3.2, wallColor: '#7A8FA8', roofColor: '#5A5F6B', trimColor: '#EDE9DE', roofType: 'flat', hasParapet: true },
  mine:      { footprint: 28, wallHeight: 5,  roofPeak: 0.0, wallThickness: 0.6, doorWidth: 4.0, doorHeight: 3.2, wallColor: '#5A5F6B', roofColor: '#3A2418', trimColor: '#7A8090', roofType: 'flat', towerCount: 1, towerRole: 'smokestack' },
  hall:      { footprint: 36, footprintZ: 30, wallHeight: 9,  roofPeak: 4.5, wallThickness: 0.5, doorWidth: 3.6, doorHeight: 3.6, wallColor: '#D8C9A8', roofColor: '#7A8090', trimColor: '#EDE9DE', roofType: 'pyramid', towerCount: 4, towerRole: 'column' },
  factory:   { footprint: 36, footprintZ: 32, wallHeight: 8,  roofPeak: 2.5, wallThickness: 0.6, doorWidth: 5.0, doorHeight: 3.8, wallColor: '#5A5F6B', roofColor: '#7A8090', trimColor: '#3A2418', roofType: 'sawtooth' },
  bank:      { footprint: 34, wallHeight: 9,  roofPeak: 4.5, wallThickness: 0.6, doorWidth: 3.4, doorHeight: 3.6, wallColor: '#D8C9A8', roofColor: '#B0AA8E', trimColor: '#F5C842', roofType: 'dome', towerCount: 2, towerRole: 'turret' },
};

export const DEFAULT_BUILDING_SPEC: BuildingSpec = BUILDING_SPECS.apartment;
