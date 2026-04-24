import {
  Scene,
  Mesh,
  Vector3,
  VertexData,
  MeshBuilder,
  AbstractMesh,
  Material,
} from '@babylonjs/core';

/**
 * Clean roof geometry helpers — use proper vertex data instead of the
 * MeshBuilder.CreateCylinder(tessellation:3) rotation hack that produced
 * "sideways triangular pyramid" artifacts.
 *
 * Conventions
 * - Roof is built in local space, centered at (0, 0, 0) with the ridge
 *   running along the local x axis by default.
 * - Caller positions + parents the returned mesh.
 * - All roofs return a single Mesh — set material + receiveShadows at the
 *   call site.
 */

/**
 * Gable roof — a triangular prism. Two rectangular sloped faces meet at
 * a ridge running along +x, with triangular end caps on ±z.
 *
 * Width is the across-the-ridge span (z axis). Length is along the ridge
 * (x axis). Peak is the height above the eaves line (y=0).
 */
export function buildGableRoof(
  scene: Scene,
  id: string | number,
  length: number,
  width: number,
  peak: number,
  overhang: number = 0.4,
): Mesh {
  const L = length + overhang * 2; // along x
  const W = width + overhang * 2;  // across z
  const H = peak;

  const hL = L / 2;
  const hW = W / 2;

  // 6 vertices: 2 eaves corners per end (4) + 2 ridge points (2)
  //
  //      ridge1 ─────────── ridge2        ← top
  //       /\                 /\
  //      /  \               /  \
  //   e0 ───── e1         e2 ───── e3     ← eaves
  //
  //   local axes: x = along ridge, z = across, y = up
  const positions = [
    // eave corners (y=0)
    -hL, 0, -hW,   //  0  e0 front-left
    -hL, 0,  hW,   //  1  e1 back-left
     hL, 0,  hW,   //  2  e2 back-right
     hL, 0, -hW,   //  3  e3 front-right
    // ridge endpoints (y=peak)
    -hL, H, 0,     //  4  ridge-left
     hL, H, 0,     //  5  ridge-right
  ];

  // Faces (quads decomposed into triangles, winding = outward normal)
  const indices = [
    // front slope (z < 0) — e0, e3, ridge-right, ridge-left
    0, 4, 5,  0, 5, 3,
    // back slope (z > 0) — e1, ridge-left, ridge-right, e2
    1, 2, 5,  1, 5, 4,
    // left gable cap (x = -hL)
    0, 1, 4,
    // right gable cap (x = +hL)
    3, 5, 2,
    // underside (flat — faces down)
    0, 3, 2,  0, 2, 1,
  ];

  const mesh = new Mesh(`gable_${id}`, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = [];
  VertexData.ComputeNormals(positions, indices, vd.normals as number[]);
  vd.applyToMesh(mesh);
  return mesh;
}

/**
 * Pyramid roof — proper 4-sided pyramid with apex at top center.
 *
 * footprintLength × footprintWidth at y=0, single apex at y=peak directly
 * above center.
 */
export function buildPyramidRoof(
  scene: Scene,
  id: string | number,
  length: number,
  width: number,
  peak: number,
  overhang: number = 0.4,
): Mesh {
  const L = length + overhang * 2;
  const W = width + overhang * 2;
  const hL = L / 2;
  const hW = W / 2;

  const positions = [
    // 4 base corners (y=0)
    -hL, 0, -hW,   // 0  front-left
     hL, 0, -hW,   // 1  front-right
     hL, 0,  hW,   // 2  back-right
    -hL, 0,  hW,   // 3  back-left
    // apex
      0, peak, 0,  // 4
  ];

  const indices = [
    0, 1, 4,  // front slope
    1, 2, 4,  // right slope
    2, 3, 4,  // back slope
    3, 0, 4,  // left slope
    // underside
    0, 3, 2,  0, 2, 1,
  ];

  const mesh = new Mesh(`pyramid_${id}`, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = [];
  VertexData.ComputeNormals(positions, indices, vd.normals as number[]);
  vd.applyToMesh(mesh);
  return mesh;
}

/**
 * Sawtooth roof — N identical gable bays in a row with ridges running
 * along x. Each bay is a mini gable covering `bayWidth` along z. Returns
 * a Mesh with all bays merged via VertexData.
 *
 * Suitable for factory roofs: ridges run front-to-back, seen as a zigzag
 * from the side.
 */
export function buildSawtoothRoof(
  scene: Scene,
  id: string | number,
  length: number,   // along x (ridge length per bay)
  totalWidth: number, // along z (divided into `bays` bays)
  peak: number,
  bays: number,
  overhang: number = 0.3,
): Mesh {
  const bayWidth = totalWidth / bays;
  const hW = bayWidth / 2;
  const L = length + overhang * 2;
  const hL = L / 2;
  const H = peak;

  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < bays; i++) {
    const bayCenterZ = -totalWidth / 2 + bayWidth * (i + 0.5);
    const base = positions.length / 3;

    positions.push(
      // eaves
      -hL, 0, bayCenterZ - hW,  // 0
      -hL, 0, bayCenterZ + hW,  // 1
       hL, 0, bayCenterZ + hW,  // 2
       hL, 0, bayCenterZ - hW,  // 3
      // ridge
      -hL, H, bayCenterZ,       // 4
       hL, H, bayCenterZ,       // 5
    );
    indices.push(
      base + 0, base + 4, base + 5,
      base + 0, base + 5, base + 3,
      base + 1, base + 2, base + 5,
      base + 1, base + 5, base + 4,
      base + 0, base + 1, base + 4,
      base + 3, base + 5, base + 2,
      base + 0, base + 3, base + 2,
      base + 0, base + 2, base + 1,
    );
  }

  const mesh = new Mesh(`sawtooth_${id}`, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = [];
  VertexData.ComputeNormals(positions, indices, vd.normals as number[]);
  vd.applyToMesh(mesh);
  return mesh;
}

/**
 * Hemisphere dome — a sphere clipped below the equator. Used for bank
 * dome + silo caps + turret caps.
 */
export function buildDome(
  scene: Scene,
  id: string | number,
  diameter: number,
  heightScale: number = 0.85,
): Mesh {
  const dome = MeshBuilder.CreateSphere(`dome_${id}`, {
    diameter, segments: 24, arc: 1, slice: 0.5,
  }, scene);
  dome.scaling.y = heightScale;
  return dome;
}

/**
 * Apply one material + receive-shadows + add to casters in one call —
 * keeps per-type builders clean.
 */
export function finishRoof(mesh: Mesh, mat: Material, casters: AbstractMesh[]): Mesh {
  mesh.material = mat;
  mesh.receiveShadows = true;
  casters.push(mesh);
  return mesh;
}

/**
 * Helper: place a mesh at (x, y, z) relative to a parent node.
 */
export function placeAt(mesh: Mesh, x: number, y: number, z: number): Mesh {
  mesh.position.set(x, y, z);
  return mesh;
}

/**
 * Shared geometry: a "plank" — thin, wide, long box. Useful for boards,
 * trim strips, fence rails.
 */
export function plank(scene: Scene, name: string, length: number, thickness: number, depth: number): Mesh {
  return MeshBuilder.CreateBox(name, { width: length, height: thickness, depth }, scene);
}

/**
 * Shared geometry: a post — thin tall box.
 */
export function post(scene: Scene, name: string, height: number, thickness: number = 0.18): Mesh {
  return MeshBuilder.CreateBox(name, { width: thickness, height, depth: thickness }, scene);
}

/**
 * Stub tree — two cylinders (trunk + canopy sphere). Coarse but readable.
 */
export function buildTree(
  scene: Scene,
  id: string,
  trunkMat: Material,
  leafMat: Material,
  height: number = 4,
): Mesh {
  const trunk = MeshBuilder.CreateCylinder(`tree_${id}_trunk`, {
    diameter: 0.5, height: height * 0.45, tessellation: 8,
  }, scene);
  trunk.position.y = height * 0.45 / 2;
  trunk.material = trunkMat;

  const leaves = MeshBuilder.CreateSphere(`tree_${id}_leaves`, {
    diameter: height * 0.85, segments: 10,
  }, scene);
  leaves.parent = trunk;
  leaves.position.y = height * 0.45 / 2 + 0.4;
  leaves.material = leafMat;

  return trunk;
}

/**
 * Picket fence segment — horizontal rails with vertical pickets.
 * Runs along x axis with length `length`, total height `h`.
 */
export function buildFenceSegment(
  scene: Scene,
  id: string,
  length: number,
  h: number,
  mat: Material,
): Mesh {
  // Create a parent mesh (invisible) with fence pieces as children via CSG-merge.
  // Simpler: return a TransformNode-less version by creating the posts inline.
  // For now, return the rail; caller parents posts separately.
  const rail = MeshBuilder.CreateBox(`fence_${id}_rail`, {
    width: length, height: 0.06, depth: 0.08,
  }, scene);
  rail.material = mat;
  return rail;
}
