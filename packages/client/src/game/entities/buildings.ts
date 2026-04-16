import {
  Scene,
  MeshBuilder,
  Color3,
  StandardMaterial,
  AbstractMesh,
} from '@babylonjs/core';

// ---------------------------------------------------------------------------
// Parcel grid — uniform 50×50 grid replacing legacy districts/landmarks
// ---------------------------------------------------------------------------

/** Definition for a single parcel on the grid. */
export interface ParcelDef {
  /** Unique numeric ID: `gx * GRID_SIZE + gy`. */
  id: number;
  /** Grid column index (0 = west, GRID_SIZE-1 = east). */
  grid_x: number;
  /** Grid row index (0 = south, GRID_SIZE-1 = north). */
  grid_y: number;
  /** World-space centre X of the parcel. */
  x: number;
  /** World-space centre Z of the parcel. */
  z: number;
}

// --- Grid configuration -----------------------------------------------------

/** Number of parcels along each axis. */
export const GRID_COLS = 50;

/** Number of parcels along each axis. */
export const GRID_ROWS = 50;

/** Size of each parcel cell (metres). */
const CELL_SIZE = 40;

/** Width of roads between parcels (metres). */
const ROAD_WIDTH = 8;

/**
 * Total grid footprint:
 *   total = COLS * CELL_SIZE + (COLS - 1) * ROAD_WIDTH
 *        = 50 * 40 + 49 * 8 = 2000 + 392 = 2392
 *
 * Parcels are centred around (0, 0) in world space.
 */
const GRID_TOTAL_W = GRID_COLS * CELL_SIZE + (GRID_COLS - 1) * ROAD_WIDTH;
const GRID_TOTAL_H = GRID_ROWS * CELL_SIZE + (GRID_ROWS - 1) * ROAD_WIDTH;

// The stride from one cell origin to the next (cell + road)
const STRIDE = CELL_SIZE + ROAD_WIDTH;

// ---------------------------------------------------------------------------
// Grid generation
// ---------------------------------------------------------------------------

/** Generate the full parcel grid. */
export function generateParcelGrid(): ParcelDef[] {
  const parcels: ParcelDef[] = [];

  for (let gy = 0; gy < GRID_ROWS; gy++) {
    for (let gx = 0; gx < GRID_COLS; gx++) {
      const x = gx * STRIDE - GRID_TOTAL_W / 2 + CELL_SIZE / 2;
      const z = gy * STRIDE - GRID_TOTAL_H / 2 + CELL_SIZE / 2;

      parcels.push({
        id: gx * GRID_COLS + gy,
        grid_x: gx,
        grid_y: gy,
        x,
        z,
      });
    }
  }

  return parcels;
}

/** Pre-computed grid of 2,500 parcels. */
export const ALL_PARCELS = generateParcelGrid();

// ---------------------------------------------------------------------------
// Public API — spawn grid into scene
// ---------------------------------------------------------------------------

/**
 * Spawn the uniform parcel grid into the given Babylon scene.
 *
 * Replaces the old district/landmark system with a flat ground plane,
 * grid roads, and empty parcel slots.
 *
 * @returns An array of every mesh created.
 */
export function spawnBuildings(scene: Scene): AbstractMesh[] {
  const meshes: AbstractMesh[] = [];

  // ---- Base ground plane — soft meadow green, slightly recessed ----
  const groundSize = Math.max(GRID_TOTAL_W, GRID_TOTAL_H) + 200;
  const ground = MeshBuilder.CreateGround('gridGround', {
    width: groundSize,
    height: groundSize,
    subdivisions: 8,
  }, scene);
  const groundMat = new StandardMaterial('gridGroundMat', scene);
  groundMat.diffuseColor = new Color3(0.55, 0.78, 0.48);  // fresher pastel grass
  groundMat.specularColor = new Color3(0.02, 0.02, 0.02); // very low spec = matte cartoon
  ground.material = groundMat;
  ground.position.y = -0.5;
  ground.receiveShadows = true;
  meshes.push(ground);

  // ---- Roads — asphalt grey, matte ----
  const roadMat = new StandardMaterial('gridRoadMat', scene);
  roadMat.diffuseColor = new Color3(0.32, 0.34, 0.38);
  roadMat.specularColor = new Color3(0.02, 0.02, 0.02);

  // Horizontal roads
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

  // Vertical roads
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

  // ---- Parcel lots — soft sand-coloured circular pads ----
  // Each lot is an inscribed disc so the grid reads like cartoon
  // stepping-stones with visible road channels between them — no sharp
  // corners, no overlap into roads.
  const lotMat = new StandardMaterial('lotMat', scene);
  lotMat.diffuseColor = new Color3(0.82, 0.76, 0.6);
  lotMat.specularColor = new Color3(0.03, 0.03, 0.03);

  // Disc radius: fits inside the cell with margin of road visible.
  const LOT_RADIUS = (CELL_SIZE - ROAD_WIDTH) * 0.5 + 1.2;

  for (const parcel of ALL_PARCELS) {
    const lot = MeshBuilder.CreateDisc(`lot_${parcel.id}`, {
      radius: LOT_RADIUS,
      tessellation: 24,
    }, scene);
    lot.rotation.x = Math.PI / 2; // lay flat
    lot.position.set(parcel.x, 0.1, parcel.z);
    lot.material = lotMat; // all 2,500 share one material = one shader bind
    lot.isPickable = true;
    lot.metadata = { parcelId: parcel.id };
    meshes.push(lot);
  }

  return meshes;
}

// ---------------------------------------------------------------------------
// Legacy compatibility re-exports (consumers may still reference these)
// ---------------------------------------------------------------------------

/** @deprecated Use ParcelDef instead. Kept for backward compatibility. */
export interface BuildingDef {
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  color: [number, number, number];
  district: string;
  purchasable: boolean;
}

/** @deprecated Use ALL_PARCELS instead. */
export const ALL_BUILDINGS: BuildingDef[] = [];
