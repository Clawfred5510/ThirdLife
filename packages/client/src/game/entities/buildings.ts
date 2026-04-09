import {
  Scene,
  MeshBuilder,
  Vector3,
  Color3,
  StandardMaterial,
  AbstractMesh,
} from '@babylonjs/core';

/** Definition for a single building or landmark in Haven Point. */
export interface BuildingDef {
  name: string;
  /** Design coordinate X (0-2000). */
  x: number;
  /** Design coordinate Z (0-2000). */
  z: number;
  width: number;
  depth: number;
  height: number;
  /** RGB colour, each channel 0-1. */
  color: [number, number, number];
  district: string;
  purchasable: boolean;
}

// ---------------------------------------------------------------------------
// Landmark buildings (non-purchasable, hand-placed from the design doc)
// ---------------------------------------------------------------------------

const LANDMARKS: BuildingDef[] = [
  { name: 'City Hall',       x: 1400, z: 800,  width: 60,  depth: 60,  height: 15,  color: [0.85, 0.85, 0.8],  district: 'Downtown',      purchasable: false },
  { name: 'Haven Tower',     x: 1500, z: 700,  width: 30,  depth: 30,  height: 40,  color: [0.7, 0.75, 0.85],  district: 'Downtown',      purchasable: false },
  { name: 'Central Market',  x: 1350, z: 600,  width: 50,  depth: 50,  height: 5,   color: [0.8, 0.6, 0.3],    district: 'Downtown',      purchasable: false },
  { name: 'Grand Stage',     x: 500,  z: 800,  width: 80,  depth: 60,  height: 8,   color: [0.6, 0.3, 0.6],    district: 'Entertainment', purchasable: false },
  { name: 'Haven Park',      x: 450,  z: 1600, width: 100, depth: 100, height: 0.5, color: [0.3, 0.7, 0.3],    district: 'Residential',   purchasable: false },
  { name: 'Power Plant',     x: 1800, z: 1700, width: 60,  depth: 60,  height: 20,  color: [0.4, 0.4, 0.4],    district: 'Industrial',    purchasable: false },
  { name: 'Freight Yard',    x: 1500, z: 1800, width: 80,  depth: 80,  height: 3,   color: [0.45, 0.42, 0.4],  district: 'Industrial',    purchasable: false },
  { name: 'Lighthouse',      x: 1950, z: 50,   width: 10,  depth: 10,  height: 25,  color: [0.9, 0.9, 0.85],   district: 'Waterfront',    purchasable: false },
  { name: 'Haven Marina',    x: 1700, z: 150,  width: 60,  depth: 40,  height: 4,   color: [0.5, 0.4, 0.3],    district: 'Waterfront',    purchasable: false },
];

// ---------------------------------------------------------------------------
// District bounds used for procedural purchasable-plot generation
// ---------------------------------------------------------------------------

interface DistrictBounds {
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Base colour for purchasable plots (slightly lighter than ground). */
  plotColor: [number, number, number];
}

const DISTRICT_BOUNDS: DistrictBounds[] = [
  { name: 'Downtown',      x1: 1100, y1: 400,  x2: 1800, y2: 1100, plotColor: [0.7, 0.73, 0.78] },
  { name: 'Residential',   x1: 100,  y1: 1100, x2: 900,  y2: 1900, plotColor: [0.55, 0.75, 0.45] },
  { name: 'Industrial',    x1: 1100, y1: 1200, x2: 1900, y2: 1900, plotColor: [0.58, 0.58, 0.56] },
  { name: 'Waterfront',    x1: 1200, y1: 0,    x2: 2000, y2: 500,  plotColor: [0.82, 0.78, 0.62] },
  { name: 'Entertainment', x1: 100,  y1: 400,  x2: 900,  y2: 1100, plotColor: [0.65, 0.55, 0.7] },
];

/**
 * Deterministic pseudo-random number generator (mulberry32) so procedural
 * plot layouts are reproducible across sessions.
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate purchasable plot definitions for every district. */
function generatePurchasablePlots(): BuildingDef[] {
  const plots: BuildingDef[] = [];
  const rand = mulberry32(42);

  for (const d of DISTRICT_BOUNDS) {
    const marginX = (d.x2 - d.x1) * 0.1;
    const marginY = (d.y2 - d.y1) * 0.1;
    const innerX1 = d.x1 + marginX;
    const innerX2 = d.x2 - marginX;
    const innerY1 = d.y1 + marginY;
    const innerY2 = d.y2 - marginY;

    const cols = 4;
    const rows = 3;
    const cellW = (innerX2 - innerX1) / cols;
    const cellH = (innerY2 - innerY1) / rows;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = innerX1 + (c + 0.5) * cellW;
        const cz = innerY1 + (r + 0.5) * cellH;

        const w = 20 + rand() * 20;   // 20-40
        const dp = 20 + rand() * 20;   // 20-40
        const h = 3 + rand() * 5;      // 3-8

        plots.push({
          name: `${d.name}_Plot_${r}_${c}`,
          x: cx,
          z: cz,
          width: w,
          depth: dp,
          height: h,
          color: d.plotColor,
          district: d.name,
          purchasable: true,
        });
      }
    }
  }

  return plots;
}

// ---------------------------------------------------------------------------
// Combined building list
// ---------------------------------------------------------------------------

export const ALL_BUILDINGS: BuildingDef[] = [...LANDMARKS, ...generatePurchasablePlots()];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Spawn all buildings and landmarks into the given Babylon scene.
 *
 * Design coordinates (0-2000) are converted to Babylon world coordinates:
 *   babylon.x = design.x - 1000
 *   babylon.y = height / 2          (box pivot is at centre)
 *   babylon.z = design.z - 1000
 *
 * @returns An array of every mesh created.
 */
export function spawnBuildings(scene: Scene): AbstractMesh[] {
  const meshes: AbstractMesh[] = [];

  for (const def of ALL_BUILDINGS) {
    const mesh = MeshBuilder.CreateBox(
      `bldg_${def.name}`,
      { width: def.width, height: def.height, depth: def.depth },
      scene,
    );

    mesh.position = new Vector3(
      def.x - 1000,
      def.height / 2,
      def.z - 1000,
    );

    const mat = new StandardMaterial(`bldgMat_${def.name}`, scene);
    mat.diffuseColor = new Color3(def.color[0], def.color[1], def.color[2]);
    mesh.material = mat;

    meshes.push(mesh);
  }

  return meshes;
}
