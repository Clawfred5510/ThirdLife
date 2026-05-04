import {
  Scene, Vector3, TransformNode, MeshBuilder,
  AssetContainer, SceneLoader, AbstractMesh,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { BuildingSpec, BuildingOutput } from './shared';

/**
 * GLB-backed building renderer.
 *
 * Each entry in ASSET_BY_TYPE points at a Meshy.AI export sitting at
 * /assets/models/buildings/<file>. We load each file once into a cached
 * AssetContainer and instantiate fresh copies into the world via
 * instantiateModelsToScene() — this is the cheapest way to spawn many
 * copies of the same model in Babylon (instances share geometry +
 * materials with the template).
 *
 * After instantiation, fitToFootprint() normalizes the model: scaled
 * uniformly so its longest XZ side equals PARCEL_FOOTPRINT, then
 * shifted so the bbox center sits at the parcel center and the bottom
 * sits on the ground. Meshy exports come at unpredictable scales, so
 * this normalization is mandatory rather than optional.
 *
 * Async path: the building factory currently returns synchronously, so
 * we return an empty BuildingOutput immediately (with a small invisible
 * collision box) and the visible meshes pop in once the GLB resolves.
 * No shadows on GLB buildings for now — keeps the loader simple; can
 * be added later by calling addShadowCaster() inside the .then().
 */

const ASSET_BY_TYPE: Record<string, string> = {
  apartment: 'apartment.glb',
  bank:      'bank.glb',
  factory:   'factory.glb',
  farm:      'farm.glb',
  hall:      'hall.glb',
  house:     'house.glb',
  mine:      'mine.glb',
  office:    'office.glb',
  shop:      'shop.glb',
  // No market.glb / powerplant unmapped — fall through to procedural.
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
  const root = new TransformNode(`glb_${type}_${id}`, scene);
  root.position.copyFrom(position);

  const filename = ASSET_BY_TYPE[type];
  if (!filename) throw new Error(`buildGlbBuilding: no GLB mapped for type '${type}'`);

  const collider = MeshBuilder.CreateBox(`glbCol_${type}_${id}`, {
    width: PARCEL_FOOTPRINT * 0.75,
    height: COLLIDER_HEIGHT,
    depth: PARCEL_FOOTPRINT * 0.75,
  }, scene);
  collider.parent = root;
  collider.position.y = COLLIDER_HEIGHT / 2;
  collider.isVisible = false;
  collider.checkCollisions = true;
  collider.isPickable = true;

  // Capture parcel-anchor for the post-load fit pass — we recenter the
  // model around this XZ regardless of where Meshy put the origin.
  const parcelX = position.x;
  const parcelZ = position.z;

  loadContainer(scene, filename).then((container) => {
    const inst = container.instantiateModelsToScene(undefined, false);
    for (const node of inst.rootNodes) node.parent = root;
    // Make non-collider geometry non-colliding (the box is the only
    // collision surface). Keep them pickable so parcel clicks work.
    const meshes = root.getChildMeshes(false).filter((m) => m !== collider);
    for (const m of meshes) {
      m.checkCollisions = false;
      m.isPickable = true;
    }
    fitToFootprint(root, meshes, PARCEL_FOOTPRINT, parcelX, parcelZ);
  }).catch((err) => {
    console.error(`[buildings] failed to load ${filename}:`, err);
  });

  void spec; // visual scale is handled by fitToFootprint, not the legacy spec

  return {
    root,
    exteriorCasters: [],     // shadows are handled later — see module note
    collisionWalls: [collider],
    roofMeshes: [],          // GLB buildings have no interior to fade into
    centerXZ: [position.x, position.z],
    halfExtentsXZ: [PARCEL_FOOTPRINT / 2, PARCEL_FOOTPRINT / 2],
    interiorHeight: 0,
  };
}

/**
 * Two-pass normalization. Pass 1 measures unscaled XZ extent and picks
 * a uniform scale; Pass 2 measures the post-scale bounding box and
 * shifts root.position so the model's XZ centroid sits at (parcelX,
 * parcelZ) and the bottom rests at y = 0.
 */
function fitToFootprint(
  root: TransformNode,
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
  root.scaling = new Vector3(scale, scale, scale);

  const m2 = measure();
  const cx = (m2.minX + m2.maxX) / 2;
  const cz = (m2.minZ + m2.maxZ) / 2;
  root.position.x += parcelX - cx;
  root.position.z += parcelZ - cz;
  root.position.y -= m2.minY;
}

/** Test/dev helper — clears the loaded container cache. */
export function resetGlbCacheForTesting(): void {
  containers.forEach((c) => c.dispose());
  containers.clear();
  loading.clear();
}
