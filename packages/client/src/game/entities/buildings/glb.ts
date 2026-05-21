import {
  Scene, Vector3, TransformNode, MeshBuilder, AssetContainer, SceneLoader,
  AbstractMesh, Mesh, StandardMaterial, Color3, VertexBuffer, VertexData,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { BuildingSpec, BuildingOutput } from './shared';

/**
 * GLB-backed building renderer (Meshy.AI assets).
 *
 * The current Meshy exports are GEOMETRY-ONLY — no materials, textures,
 * or normals (verified per-file: materials=0, textures=0, images=0,
 * single POSITION attribute per primitive). Until the user re-exports
 * from Meshy with the textured / PBR option enabled, this loader
 * applies a fallback paint job so each building reads as its painted
 * reference image:
 *
 *  1. Compute flat normals (so the lighting model has something to
 *     work with).
 *  2. Bake vertex colours based on Y position — wall colour for
 *     vertices below a per-type split fraction, roof colour above.
 *     The result is a 2-tone painted look that approximates each
 *     building's signature wall + roof distinction (red barn + green
 *     gambrel, yellow house + slate gable, brick apartment + slate,
 *     etc.). The actual colours come from the gamedesigns/<type>.png
 *     reference set; tuned by eye.
 *  3. Apply a single material that consumes those vertex colours.
 *
 * No interior shell. The GLB is treated as a solid object — player
 * collides with a tight box at the building footprint and walks
 * around it. Per-building bespoke walkable areas (e.g. only the
 * mine shaft on the mine, only the storefront on a shop) are a
 * separate future pass driven by the visual reference.
 */

// GLB asset mapping — buildings listed here render from a baked Meshy
// export. Buildings NOT in the map fall through to the procedural
// builders in proceduralBuilding.ts (which still handles farm, house,
// bank, factory, hall, mine, market, shop, office, apartment via code).
//
// Add a new asset by dropping <name>.glb into
// packages/client/public/assets/models/buildings/ and adding a row
// here keyed by the BuildingType (matches packages/shared constants).
const ASSET_BY_TYPE: Record<string, string> = {
  // Tier 4 energy. Owner-added 2026-05-21.
  nuclear_plant: 'nuclear-reactor.glb',
};

interface PaintRecipe {
  /** Hex colour of the wall / lower portion of the building. */
  wall: string;
  /** Hex colour of the roof / upper portion. */
  roof: string;
  /** Fraction of building height where wall transitions to roof.
   *  0.7 = lower 70% is wall colour, upper 30% is roof. */
  split: number;
  /** Optional rotation around Y axis applied to the GLB to face the
   *  parcel road. Most assets export facing -Z; tweak per-type if a
   *  given Meshy export is rotated weirdly. Radians. */
  yawOffset?: number;
}

// Colours read directly off the gamedesigns/<type>.png references.
const PAINT_BY_TYPE: Record<string, PaintRecipe> = {
  // Two-storey brick apartment: terra-cotta walls, dark slate parapet.
  apartment:  { wall: '#A6543A', roof: '#2D3138', split: 0.78 },
  // Neoclassical bank: cream sandstone with charcoal roof + pediment.
  bank:       { wall: '#D7C4A2', roof: '#26201A', split: 0.74 },
  // Brick factory with sawtooth roof + chimneys.
  factory:    { wall: '#B5563A', roof: '#2C2520', split: 0.62 },
  // Red barn with green gambrel roof — the gambrel is huge so split low.
  farm:       { wall: '#9C3C28', roof: '#3D7C3F', split: 0.45 },
  // City hall: cream sandstone with brick accents, dark roof.
  hall:       { wall: '#D7C4A2', roof: '#26201A', split: 0.74 },
  // Yellow clapboard suburban house with steep slate gable.
  house:      { wall: '#E2A130', roof: '#384357', split: 0.55 },
  // Wood + stone mine pithead with teal-green roof.
  mine:       { wall: '#6F4626', roof: '#3F7A6B', split: 0.55 },
  // Beige stone office with dark parapet.
  office:     { wall: '#A8A498', roof: '#26201A', split: 0.78 },
  // Yellow shop walls with dark trim band at the top.
  shop:       { wall: '#E2A130', roof: '#2C2520', split: 0.80 },
};

const PARCEL_FOOTPRINT = 32;
const COLLIDER_HEIGHT = 8;

const containers = new Map<string, AssetContainer>();
const loading = new Map<string, Promise<AssetContainer>>();

function loadContainer(scene: Scene, filename: string): Promise<AssetContainer> {
  const cached = containers.get(filename);
  if (cached) return Promise.resolve(cached);
  const inflight = loading.get(filename);
  if (inflight) return inflight;
  const p = SceneLoader.LoadAssetContainerAsync(
    '/assets/models/buildings/',
    filename,
    scene,
  ).then((container) => {
    containers.set(filename, container);
    loading.delete(filename);
    return container;
  }).catch((err) => {
    loading.delete(filename);
    throw err;
  });
  loading.set(filename, p);
  return p;
}

export function hasGlbAsset(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(ASSET_BY_TYPE, type);
}

export function buildGlbBuilding(
  scene: Scene,
  id: string | number,
  position: Vector3,
  spec: BuildingSpec,
  type: string,
): BuildingOutput {
  void spec;

  const root = new TransformNode(`glb_${type}_${id}`, scene);
  root.position.copyFrom(position);

  const filename = ASSET_BY_TYPE[type];
  if (!filename) throw new Error(`buildGlbBuilding: no GLB mapped for type '${type}'`);

  // Tight invisible collision box at the building footprint. Player
  // walks around the building; nothing inside to enter for now.
  const collider = MeshBuilder.CreateBox(`glbCol_${type}_${id}`, {
    width: PARCEL_FOOTPRINT * 0.78,
    height: COLLIDER_HEIGHT,
    depth: PARCEL_FOOTPRINT * 0.78,
  }, scene);
  collider.parent = root;
  collider.position.y = COLLIDER_HEIGHT / 2;
  collider.isVisible = false;
  collider.checkCollisions = true;
  collider.isPickable = true;

  // GLB lives under its own wrap so fit-to-footprint scaling doesn't
  // touch the collider.
  const glbWrap = new TransformNode(`glbWrap_${type}_${id}`, scene);
  glbWrap.parent = root;

  const parcelX = position.x;
  const parcelZ = position.z;
  const recipe = PAINT_BY_TYPE[type];

  loadContainer(scene, filename).then((container) => {
    const inst = container.instantiateModelsToScene(undefined, false);
    for (const node of inst.rootNodes) node.parent = glbWrap;

    const meshes = glbWrap.getChildMeshes(false);
    fitToFootprintWrap(glbWrap, meshes, PARCEL_FOOTPRINT, parcelX, parcelZ);
    if (recipe?.yawOffset) glbWrap.rotation.y = recipe.yawOffset;

    // Re-measure post-scale so we know the world-Y range for the
    // wall→roof colour split.
    const yRange = computeWorldYRange(meshes);

    // When a PaintRecipe is defined we use the legacy two-tone vertex-
    // colour pipeline + a white StandardMaterial to consume them.
    // Without a recipe we preserve the GLB's own embedded materials
    // (PBR textures from Meshy, baked vertex colours, etc.) which is
    // the path the nuclear_plant uses.
    const sharedMat = recipe ? vertexColorMatFor(scene, type) : null;
    for (const m of meshes) {
      ensureNormals(m);
      if (m instanceof Mesh && recipe && yRange) {
        applyTwoToneVertexColors(m, recipe, yRange);
      }
      if (sharedMat) m.material = sharedMat;
      m.checkCollisions = false;
      m.isPickable = true;
      m.receiveShadows = true;
    }
  }).catch((err) => {
    console.error(`[buildings] failed to load ${filename}:`, err);
  });

  return {
    root,
    exteriorCasters: [],   // shadow casting deferred — would need post-load registration
    collisionWalls: [collider],
    roofMeshes: [],        // no interior to fade into
    centerXZ: [position.x, position.z],
    halfExtentsXZ: [PARCEL_FOOTPRINT / 2, PARCEL_FOOTPRINT / 2],
    interiorHeight: 0,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Materials + vertex colors
// ──────────────────────────────────────────────────────────────────────

const matCache = new Map<string, StandardMaterial>();

/**
 * Per-type material that renders vertex colours. Diffuse stays white
 * so vertex colours come through unchanged; specular is muted to keep
 * the look matte; small emissive lift so the shadow side still reads.
 */
function vertexColorMatFor(scene: Scene, type: string): StandardMaterial {
  const cached = matCache.get(type);
  if (cached) return cached;
  const m = new StandardMaterial(`glbVcol-${type}`, scene);
  m.diffuseColor = new Color3(1, 1, 1);
  m.specularColor = new Color3(0.04, 0.04, 0.04);
  m.emissiveColor = new Color3(0.10, 0.09, 0.07);
  matCache.set(type, m);
  return m;
}

function applyTwoToneVertexColors(mesh: Mesh, recipe: PaintRecipe, yRange: { min: number; max: number }): void {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!positions) return;
  const wall = Color3.FromHexString(recipe.wall);
  const roof = Color3.FromHexString(recipe.roof);
  const range = yRange.max - yRange.min;
  if (range <= 0) return;

  const splitWorldY = yRange.min + range * recipe.split;

  // Convert split from world Y → mesh-local Y by reading the mesh's
  // world matrix and transforming back.
  const worldMatrix = mesh.computeWorldMatrix(true);
  const inv = worldMatrix.clone().invert();

  const colors = new Float32Array((positions.length / 3) * 4);
  for (let i = 0, c = 0; i < positions.length; i += 3, c += 4) {
    // Transform local vertex to world to compare against splitWorldY.
    const lx = positions[i], ly = positions[i + 1], lz = positions[i + 2];
    const wy = lx * worldMatrix.m[1] + ly * worldMatrix.m[5] + lz * worldMatrix.m[9] + worldMatrix.m[13];
    const isRoof = wy > splitWorldY;
    const rgb = isRoof ? roof : wall;
    colors[c]     = rgb.r;
    colors[c + 1] = rgb.g;
    colors[c + 2] = rgb.b;
    colors[c + 3] = 1;
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  mesh.useVertexColors = true;
  void inv;
}

function computeWorldYRange(meshes: AbstractMesh[]): { min: number; max: number } | null {
  if (meshes.length === 0) return null;
  let min = Infinity, max = -Infinity;
  for (const m of meshes) {
    m.computeWorldMatrix(true);
    const bb = m.getBoundingInfo().boundingBox;
    min = Math.min(min, bb.minimumWorld.y);
    max = Math.max(max, bb.maximumWorld.y);
  }
  return { min, max };
}

function ensureNormals(mesh: AbstractMesh): void {
  if (!(mesh instanceof Mesh)) return;
  if (mesh.isVerticesDataPresent(VertexBuffer.NormalKind)) return;
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const indices = mesh.getIndices();
  if (!positions || !indices) return;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  mesh.setVerticesData(VertexBuffer.NormalKind, normals);
}

/**
 * Two-pass normalization on glbWrap. Pass 1 measures unscaled XZ
 * extent and picks a uniform scale so the longest XZ side equals
 * `target`. Pass 2 measures post-scale and shifts wrap.position so
 * the model centroid sits at (parcelX, parcelZ) and the bottom is
 * at y = 0.
 */
function fitToFootprintWrap(
  wrap: TransformNode,
  meshes: AbstractMesh[],
  target: number,
  parcelX: number,
  parcelZ: number,
): void {
  if (meshes.length === 0) return;

  const measure = () => {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const m of meshes) {
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      minX = Math.min(minX, bb.minimumWorld.x);
      maxX = Math.max(maxX, bb.maximumWorld.x);
      minY = Math.min(minY, bb.minimumWorld.y);
      minZ = Math.min(minZ, bb.minimumWorld.z);
      maxZ = Math.max(maxZ, bb.maximumWorld.z);
    }
    return { minX, maxX, minY, minZ, maxZ };
  };

  const m1 = measure();
  const sizeXZ = Math.max(m1.maxX - m1.minX, m1.maxZ - m1.minZ);
  if (sizeXZ <= 0) return;
  const scale = target / sizeXZ;
  wrap.scaling = new Vector3(scale, scale, scale);

  const m2 = measure();
  const cx = (m2.minX + m2.maxX) / 2;
  const cz = (m2.minZ + m2.maxZ) / 2;
  wrap.position.x += parcelX - cx;
  wrap.position.z += parcelZ - cz;
  wrap.position.y -= m2.minY;
}

export function resetGlbCacheForTesting(): void {
  containers.forEach((c) => c.dispose());
  containers.clear();
  loading.clear();
  matCache.forEach((m) => m.dispose());
  matCache.clear();
}
