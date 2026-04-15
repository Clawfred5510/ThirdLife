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

  // ---- Base ground plane (grass/earth) ----
  const groundSize = Math.max(GRID_TOTAL_W, GRID_TOTAL_H) + 100;
  const ground = MeshBuilder.CreateGround('gridGround', {
    width: groundSize,
    height: groundSize,
    subdivisions: 4,
  }, scene);
  const groundMat = new StandardMaterial('gridGroundMat', scene);
  groundMat.diffuseColor = new Color3(0.3, 0.42, 0.25);
  ground.material = groundMat;
  ground.position.y = -0.02;
  meshes.push(ground);

  // ---- Grid roads ----
  const roadMat = new StandardMaterial('gridRoadMat', scene);
  roadMat.diffuseColor = new Color3(0.25, 0.25, 0.25);

  // Horizontal roads (one between each row, plus borders)
  for (let gy = 0; gy <= GRID_ROWS; gy++) {
    const z = gy * STRIDE - ROAD_WIDTH / 2 - GRID_TOTAL_H / 2;
    const road = MeshBuilder.CreateGround(`roadH_${gy}`, {
      width: GRID_TOTAL_W + ROAD_WIDTH,
      height: ROAD_WIDTH,
    }, scene);
    road.position.set(0, 0.01, z);
    road.material = roadMat;
    meshes.push(road);
  }

  // Vertical roads (one between each column, plus borders)
  for (let gx = 0; gx <= GRID_COLS; gx++) {
    const x = gx * STRIDE - ROAD_WIDTH / 2 - GRID_TOTAL_W / 2;
    const road = MeshBuilder.CreateGround(`roadV_${gx}`, {
      width: ROAD_WIDTH,
      height: GRID_TOTAL_H + ROAD_WIDTH,
    }, scene);
    road.position.set(x, 0.01, 0);
    road.material = roadMat;
    meshes.push(road);
  }

  // ---- Parcel lot markers (flat pads) ----
  const lotMat = new StandardMaterial('lotMat', scene);
  lotMat.diffuseColor = new Color3(0.45, 0.48, 0.42);

  // Only create visible lot markers for a subset to save draw calls
  // (2,500 boxes is a lot — use instancing or skip for now and just
  //  render roads as the visual grid structure)
  // Instead, render thin border outlines for every 5th parcel as grid guides
  const guideMat = new StandardMaterial('guideMat', scene);
  guideMat.diffuseColor = new Color3(0.55, 0.58, 0.52);

  for (const parcel of ALL_PARCELS) {
    // Only place guide markers every 10 parcels for orientation
    if (parcel.grid_x % 10 === 0 && parcel.grid_y % 10 === 0) {
      const marker = MeshBuilder.CreateGround(`guide_${parcel.id}`, {
        width: CELL_SIZE - 2,
        height: CELL_SIZE - 2,
      }, scene);
      marker.position.set(parcel.x, 0.03, parcel.z);
      marker.material = guideMat;
      meshes.push(marker);
    }
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
