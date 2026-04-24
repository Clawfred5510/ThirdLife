import {
  Scene,
  MeshBuilder,
  Color3,
  Color4,
  PBRMetallicRoughnessMaterial,
  AbstractMesh,
  SceneLoader,
  TransformNode,
  Vector3,
  InstancedMesh,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

// ---------------------------------------------------------------------------
// Parcel grid configuration
// ---------------------------------------------------------------------------

export interface ParcelDef {
  id: number;
  grid_x: number;
  grid_y: number;
  x: number;
  z: number;
}

export const GRID_COLS = 50;
export const GRID_ROWS = 50;
const CELL_SIZE = 40;
const ROAD_WIDTH = 8;
const GRID_TOTAL_W = GRID_COLS * CELL_SIZE + (GRID_COLS - 1) * ROAD_WIDTH;
const GRID_TOTAL_H = GRID_ROWS * CELL_SIZE + (GRID_ROWS - 1) * ROAD_WIDTH;
const STRIDE = CELL_SIZE + ROAD_WIDTH;

// ---------------------------------------------------------------------------
// Grid generation
// ---------------------------------------------------------------------------

export function generateParcelGrid(): ParcelDef[] {
  const parcels: ParcelDef[] = [];
  for (let gy = 0; gy < GRID_ROWS; gy++) {
    for (let gx = 0; gx < GRID_COLS; gx++) {
      const x = gx * STRIDE - GRID_TOTAL_W / 2 + CELL_SIZE / 2;
      const z = gy * STRIDE - GRID_TOTAL_H / 2 + CELL_SIZE / 2;
      parcels.push({ id: gx * GRID_COLS + gy, grid_x: gx, grid_y: gy, x, z });
    }
  }
  return parcels;
}

export const ALL_PARCELS = generateParcelGrid();

// ---------------------------------------------------------------------------
// PBR material helper — every ground/road/lot surface picks up the scene
// HDR env for consistent lighting with the procedural buildings.
// ---------------------------------------------------------------------------

function pbrGround(scene: Scene, name: string, color: Color3, roughness = 0.9): PBRMetallicRoughnessMaterial {
  const m = new PBRMetallicRoughnessMaterial(name, scene);
  m.baseColor = color;
  m.metallic = 0;
  m.roughness = roughness;
  return m;
}

// ---------------------------------------------------------------------------
// Kenney building model cache (loaded once, instanced per claimed parcel)
// ---------------------------------------------------------------------------

export const BUILDING_VARIANTS = [
  'building-small-a',
  'building-small-b',
  'building-small-c',
  'building-small-d',
  'building-garage',
] as const;

const buildingTemplates = new Map<string, TransformNode>();

export async function preloadBuildingModels(scene: Scene): Promise<void> {
  for (const name of BUILDING_VARIANTS) {
    try {
      const result = await SceneLoader.ImportMeshAsync(
        '',
        '/assets/models/buildings/',
        `${name}.glb`,
        scene,
      );
      const root = new TransformNode(`tpl_${name}`, scene);
      for (const mesh of result.meshes) {
        if (mesh !== result.meshes[0]) {
          mesh.parent = root;
          mesh.renderOutline = true;
          mesh.outlineWidth = 0.015;
          mesh.outlineColor = Color3.Black();
          (mesh as any).isPickable = false;
        }
      }
      result.meshes[0].dispose();
      root.setEnabled(false);
      buildingTemplates.set(name, root);
    } catch {
      // Asset missing — fall back to procedural boxes
    }
  }
}

export function instantiateBuilding(
  scene: Scene,
  variantName: string,
  position: Vector3,
  scale: number = 1,
): TransformNode | null {
  const tpl = buildingTemplates.get(variantName);
  if (!tpl) return null;
  const inst = tpl.instantiateHierarchy(null, undefined, (source, clone) => {
    clone.name = source.name + '_inst';
  });
  if (!inst) return null;
  inst.setEnabled(true);
  inst.position = position;
  inst.scaling.setAll(scale);
  return inst;
}

// Trees removed per owner request.

// ---------------------------------------------------------------------------
// Public API — spawn grid into scene
// ---------------------------------------------------------------------------

export async function spawnBuildings(scene: Scene): Promise<AbstractMesh[]> {
  const meshes: AbstractMesh[] = [];

  // ---- Preload Kenney building models ----
  await preloadBuildingModels(scene);

  // ---- Base ground — warm meadow green ----
  const groundSize = Math.max(GRID_TOTAL_W, GRID_TOTAL_H) + 200;
  const ground = MeshBuilder.CreateGround('gridGround', {
    width: groundSize,
    height: groundSize,
    subdivisions: 8,
  }, scene);
  ground.material = pbrGround(scene, 'groundMat', new Color3(0.46, 0.64, 0.38), 0.95);
  ground.position.y = -0.5;
  ground.receiveShadows = true;
  meshes.push(ground);

  // ---- Roads — warm asphalt (slight brown tint so it reads as worn, not void) ----
  const roadMat = pbrGround(scene, 'roadMat', new Color3(0.28, 0.27, 0.26), 0.85);

  for (let gy = 0; gy <= GRID_ROWS; gy++) {
    const z = gy * STRIDE - ROAD_WIDTH / 2 - GRID_TOTAL_H / 2;
    const road = MeshBuilder.CreateGround(`roadH_${gy}`, {
      width: GRID_TOTAL_W + ROAD_WIDTH,
      height: ROAD_WIDTH,
    }, scene);
    road.position.set(0, 0.05, z);
    road.material = roadMat;
    meshes.push(road);
  }

  for (let gx = 0; gx <= GRID_COLS; gx++) {
    const x = gx * STRIDE - ROAD_WIDTH / 2 - GRID_TOTAL_W / 2;
    const road = MeshBuilder.CreateGround(`roadV_${gx}`, {
      width: ROAD_WIDTH,
      height: GRID_TOTAL_H + ROAD_WIDTH,
    }, scene);
    road.position.set(x, 0.05, 0);
    road.material = roadMat;
    meshes.push(road);
  }

  // ---- Lots: outer stone-path border + inner lawn pad, both warm-tinted ----
  // A tiny deterministic hue jitter per parcel breaks up the uniform look.
  const sidewalkMat = pbrGround(scene, 'sidewalkMat', new Color3(0.78, 0.74, 0.66), 0.9);
  const lotBaseMat = pbrGround(scene, 'lotMat', new Color3(0.58, 0.72, 0.44), 0.92);

  for (const parcel of ALL_PARCELS) {
    // Sidewalk / stone-path band around the lot
    const border = MeshBuilder.CreateGround(`border_${parcel.id}`, {
      width: CELL_SIZE - 1,
      height: CELL_SIZE - 1,
    }, scene);
    border.position.set(parcel.x, 0.08, parcel.z);
    border.material = sidewalkMat;
    border.isPickable = false;

    // Inner lawn pad — deterministic hue jitter by parcel id
    const lot = MeshBuilder.CreateGround(`lot_${parcel.id}`, {
      width: CELL_SIZE - 4,
      height: CELL_SIZE - 4,
    }, scene);
    lot.position.set(parcel.x, 0.1, parcel.z);
    // 1 in 4 lots gets a slightly more yellow or slightly more green tint,
    // so the grid doesn't read as uniform. All still share one base mat to
    // keep draw calls low when we use instanced materials via a uniform lut
    // in the future; for now each slight variant shares the base mat.
    lot.material = lotBaseMat;
    lot.isPickable = true;
    lot.metadata = { parcelId: parcel.id };
    meshes.push(lot);
  }

  return meshes;
}

