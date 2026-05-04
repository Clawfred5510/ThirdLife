import {
  Scene, Vector3, TransformNode, AssetContainer, SceneLoader,
  AbstractMesh, Mesh, StandardMaterial, Color3, VertexBuffer, VertexData,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { BuildingSpec, BuildingOutput, mat, buildInteriorShell } from './shared';
import { BUILDING_SPECS, DEFAULT_BUILDING_SPEC } from '../proceduralBuilding';

/**
 * GLB-backed building renderer (Meshy.AI assets).
 *
 * Two design constraints driving this module:
 *
 * 1. Current Meshy exports are GEOMETRY-ONLY — no materials, textures,
 *    or normals. The loader paints each mesh with a StandardMaterial
 *    coloured from BUILDING_SPECS[type].wallColor and computes flat
 *    normals so the lighting actually has something to work with. When
 *    the user re-exports from Meshy with the textured / PBR option,
 *    the GLBs will already have materials and the fallback paint is
 *    a no-op (we only paint meshes that arrive without a material).
 *
 * 2. The GLBs are solid shells — no interior space. The original
 *    procedural buildings had walk-in interiors with a doorway,
 *    ceiling, and floor. We restore that experience by spawning the
 *    standard interior shell at the parcel position UNDER the GLB.
 *    Collision lives on the shell walls (with the doorway gap), so
 *    the player walks toward the building, finds the door, and enters.
 *    Once inside, the fade-when-inside mechanic dims the GLB meshes
 *    (they're listed as roofMeshes) revealing the procedural interior.
 *
 * Hierarchy:
 *   root           — at parcel center, no scaling
 *   ├─ shell       — interior walls / floor / ceiling (procedural)
 *   └─ glbWrap     — empty TransformNode that holds the loaded GLB.
 *                    Only this node gets the fit-to-footprint scale,
 *                    so the procedural shell stays at its native size.
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
};

const PARCEL_FOOTPRINT = 32;
// Shell sits inside the GLB silhouette so its walls don't peek out
// from behind the painted exterior. 22u square is comfortable interior.
const SHELL_FOOTPRINT = 22;

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
  void spec; // shell pulls its own spec from BUILDING_SPECS

  const root = new TransformNode(`glb_${type}_${id}`, scene);
  root.position.copyFrom(position);

  const filename = ASSET_BY_TYPE[type];
  if (!filename) throw new Error(`buildGlbBuilding: no GLB mapped for type '${type}'`);

  // ── Procedural interior shell (synchronous) ──────────────────────────
  const shellSpec: BuildingSpec = BUILDING_SPECS[type] ?? DEFAULT_BUILDING_SPEC;
  const wallMat = mat(scene, `glbWall-${type}`, shellSpec.wallColor, 0.85);
  const trimMat = mat(scene, `glbTrim-${type}`, shellSpec.trimColor, 0.65);

  const exteriorCasters: AbstractMesh[] = [];
  const collisionWalls: AbstractMesh[] = [];
  const roofMeshes: AbstractMesh[] = []; // mutated below + by .then()

  const shell = buildInteriorShell(
    scene, id, root, shellSpec,
    SHELL_FOOTPRINT, SHELL_FOOTPRINT,
    exteriorCasters, collisionWalls,
    wallMat, trimMat,
  );
  // The shell ceiling fades when the player is inside, same as before.
  roofMeshes.push(shell.ceiling);

  // Outer-shell walls (the ones surrounding the doorway) need to fade
  // along with the GLB so the player isn't staring at a procedural
  // wall while the painted exterior is dimmed. Take everything pushed
  // by buildInteriorShell into exteriorCasters and add to roofMeshes.
  for (const m of exteriorCasters) roofMeshes.push(m);

  // ── GLB exterior (asynchronous) ──────────────────────────────────────
  // Wrapped in its own node so fit-to-footprint scaling doesn't touch
  // the procedural shell's geometry (which has its own native scale).
  const glbWrap = new TransformNode(`glbWrap_${type}_${id}`, scene);
  glbWrap.parent = root;

  const parcelX = position.x;
  const parcelZ = position.z;

  loadContainer(scene, filename).then((container) => {
    const inst = container.instantiateModelsToScene(undefined, false);
    for (const node of inst.rootNodes) node.parent = glbWrap;

    const newMeshes = glbWrap.getChildMeshes(false);
    for (const m of newMeshes) {
      ensureNormals(m);
      if (!m.material) m.material = paintFor(scene, type, shellSpec);
      m.checkCollisions = false;     // collision is via shell walls
      m.isPickable = true;           // parcel pick still works
      m.receiveShadows = true;
      roofMeshes.push(m);            // fade when player is inside
    }

    fitToFootprintWrap(glbWrap, newMeshes, PARCEL_FOOTPRINT, parcelX, parcelZ);
  }).catch((err) => {
    console.error(`[buildings] failed to load ${filename}:`, err);
  });

  return {
    root,
    exteriorCasters,
    collisionWalls,
    roofMeshes,
    centerXZ: [position.x, position.z],
    halfExtentsXZ: [SHELL_FOOTPRINT / 2, SHELL_FOOTPRINT / 2],
    interiorHeight: shellSpec.wallHeight,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

const paintCache = new Map<string, StandardMaterial>();

function paintFor(scene: Scene, type: string, spec: BuildingSpec): StandardMaterial {
  const cached = paintCache.get(type);
  if (cached) return cached;
  const m = new StandardMaterial(`glbPaint-${type}`, scene);
  m.diffuseColor = Color3.FromHexString(spec.wallColor);
  m.specularColor = new Color3(0.04, 0.04, 0.04);     // matte, not plastic
  m.emissiveColor = Color3.FromHexString(spec.wallColor).scale(0.18); // ambient lift on shadow side
  paintCache.set(type, m);
  return m;
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
 * Scale + center the GLB sub-tree (glbWrap) so its painted silhouette
 * spans `target` units along its longest XZ side, with the centroid at
 * (parcelX, parcelZ) in WORLD space and the bottom at y = 0.
 *
 * Two passes: measure unscaled bbox → apply scale → measure scaled
 * bbox → shift glbWrap.position to land the centroid + ground line.
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
  // World-space targets — translate wrap (in world, since its parent
  // root isn't moving here) by the delta between current centroid and
  // desired (parcelX, 0, parcelZ).
  wrap.position.x += parcelX - cx;
  wrap.position.z += parcelZ - cz;
  wrap.position.y -= m2.minY;
}

export function resetGlbCacheForTesting(): void {
  containers.forEach((c) => c.dispose());
  containers.clear();
  loading.clear();
  paintCache.forEach((m) => m.dispose());
  paintCache.clear();
}
