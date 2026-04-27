import {
  Scene,
  MeshBuilder,
  Mesh,
  Vector3,
  TransformNode,
  AbstractMesh,
} from '@babylonjs/core';
import { buildFurniture } from '../buildingFurniture';
import {
  BuildingSpec,
  BuildingOutput,
  buildInteriorShell,
  buildFenceRun,
  mat, isRoofMesh } from './shared';
import { buildGableRoof, buildDome, finishRoof } from './roofPrimitives';

/**
 * FARM composition:
 * - Red barn (24×20) with proper gable roof, sliding door + hayloft window
 * - Two silos on the right side (3u diameter × 10u tall, hemispherical caps)
 * - 3×3 grid of crop plots in the front-left of the lot
 * - Stone well in the front-right corner (cylinder + wooden roof + bucket)
 * - Wooden perimeter fence around the whole lot
 * - Haystack pile on the left side
 * - Wheelbarrow parked near the barn
 */
export function buildFarm(
  scene: Scene,
  id: string | number,
  position: Vector3,
  spec: BuildingSpec,
): BuildingOutput {
  const root = new TransformNode(`farm_${id}`, scene);
  root.position.copyFrom(position);

  // Lot extents — the whole parcel (used for fence perimeter + center ref)
  const lotW = 36;
  const lotD = 32;
  const lotHalfW = lotW / 2;
  const lotHalfD = lotD / 2;

  // The BARN is smaller than the lot — offset it toward the back so the
  // front yard has space for crop plots + well.
  const barnW = 22;
  const barnD = 18;
  const barnOffsetZ = 4; // push barn toward back (+Z)
  const wallH = spec.wallHeight;
  const peak = spec.roofPeak;

  const exteriorCasters: AbstractMesh[] = [];
  const collisionWalls: AbstractMesh[] = [];

  // Materials
  const barnWallMat = mat(scene, 'barn-red', '#A8342A', 0.88);
  const barnTrimMat = mat(scene, 'barn-trim', '#F2E8D5', 0.75);
  const roofMat = mat(scene, 'barn-roof', '#2A1814', 0.7);
  const siloMat = mat(scene, 'silo-metal', '#DCD3BC', 0.55, { metallic: 0.2 });
  const siloCapMat = mat(scene, 'silo-cap', '#5A6270', 0.45, { metallic: 0.6 });
  const soilMat = mat(scene, 'soil', '#4A3020', 0.95);
  const cropMat = mat(scene, 'crop-green', '#4C7A2E', 0.9);
  const woodMat = mat(scene, 'wood-weathered', '#7A5030', 0.88);
  const darkWoodMat = mat(scene, 'wood-dark', '#3A2418', 0.85);
  const stoneMat = mat(scene, 'stone-rough', '#8A8A88', 0.92);
  const hayMat = mat(scene, 'hay', '#CFA858', 0.98);
  const metalRedMat = mat(scene, 'metal-red', '#B8453A', 0.55, { metallic: 0.35 });

  // Sub-transform for the barn, offset from lot center
  const barnRoot = new TransformNode(`barnRoot_${id}`, scene);
  barnRoot.parent = root;
  barnRoot.position.set(-6, 0, barnOffsetZ); // barn sits slightly left-back

  // ── BARN SHELL ───────────────────────────────────────────────────────
  // Use the shared shell so the front doorway + interior work correctly.
  const barnSpec: BuildingSpec = { ...spec };
  const shell = buildInteriorShell(
    scene, id, barnRoot, barnSpec,
    barnW, barnD,
    exteriorCasters, collisionWalls,
    barnWallMat, barnTrimMat,
  );

  // Horizontal board lines on the barn facades.
  // Was a single full-footprint slab per height — that slab sliced through
  // the barn interior as a brown "floor layer" the player would see when
  // walking inside. Now four thin strips per height, each hugging one
  // facade just proud of the wall, so the interior stays clear.
  const boardT = 0.08;
  for (let y = 1.5; y < wallH; y += 1.5) {
    const front = MeshBuilder.CreateBox(`board_${id}_F_${y}`, {
      width: barnW + boardT * 2, height: 0.1, depth: boardT,
    }, scene);
    front.parent = barnRoot; front.position.set(0, y, -barnD / 2 - boardT / 2); front.material = darkWoodMat;
    const back = MeshBuilder.CreateBox(`board_${id}_B_${y}`, {
      width: barnW + boardT * 2, height: 0.1, depth: boardT,
    }, scene);
    back.parent = barnRoot; back.position.set(0, y, barnD / 2 + boardT / 2); back.material = darkWoodMat;
    const left = MeshBuilder.CreateBox(`board_${id}_L_${y}`, {
      width: boardT, height: 0.1, depth: barnD,
    }, scene);
    left.parent = barnRoot; left.position.set(-barnW / 2 - boardT / 2, y, 0); left.material = darkWoodMat;
    const right = MeshBuilder.CreateBox(`board_${id}_R_${y}`, {
      width: boardT, height: 0.1, depth: barnD,
    }, scene);
    right.parent = barnRoot; right.position.set(barnW / 2 + boardT / 2, y, 0); right.material = darkWoodMat;
  }

  // (Hayloft "window" removed — user feedback: read as a brown brick over
  // the door with no clear purpose, and didn't fade with the roof. Drop.)

  // ── BARN ROOF (proper gable) ────────────────────────────────────────
  // Gable helper takes: length (along x, ridge direction), width (across z), peak
  const roof = buildGableRoof(scene, id, barnW, barnD, peak, 0.6);
  roof.parent = barnRoot;
  roof.position.y = wallH;
  finishRoof(roof, roofMat, exteriorCasters);

  // Ridge beam trim
  const ridge = MeshBuilder.CreateBox(`ridge_${id}`, {
    width: barnW + 1.2, height: 0.3, depth: 0.3,
  }, scene);
  ridge.parent = barnRoot;
  ridge.position.y = wallH + peak;
  ridge.material = darkWoodMat;
  exteriorCasters.push(ridge);

  // ── TWO SILOS on the right side of the barn ─────────────────────────
  const siloDiam = 3.0;
  const siloH = 10;
  const siloRootX = barnRoot.position.x + barnW / 2 + 2.2;
  for (let i = 0; i < 2; i++) {
    const sx = siloRootX + i * (siloDiam + 0.5);
    const silo = MeshBuilder.CreateCylinder(`silo_${id}_${i}`, {
      diameter: siloDiam, height: siloH, tessellation: 20,
    }, scene);
    silo.parent = root;
    silo.position.set(sx, siloH / 2, barnOffsetZ + 1);
    silo.material = siloMat;
    silo.receiveShadows = true;
    exteriorCasters.push(silo);

    const cap = buildDome(scene, `silo_${id}_${i}_cap`, siloDiam * 1.02, 0.55);
    cap.parent = root;
    cap.position.set(sx, siloH, barnOffsetZ + 1);
    cap.material = siloCapMat;
    exteriorCasters.push(cap);

    // Silo ring band mid-height
    const ring = MeshBuilder.CreateCylinder(`silo_${id}_${i}_ring`, {
      diameter: siloDiam * 1.05, height: 0.2, tessellation: 20,
    }, scene);
    ring.parent = root;
    ring.position.set(sx, siloH * 0.55, barnOffsetZ + 1);
    ring.material = siloCapMat;
  }

  // ── CROP PLOTS in the front yard (front-left) ───────────────────────
  // 3×3 grid of soil patches with small green crops sticking up
  const plotsOriginX = -lotHalfW + 4;
  const plotsOriginZ = -lotHalfD + 3;
  const plotSize = 3.2;
  const plotSpacing = 3.6;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const px = plotsOriginX + col * plotSpacing;
      const pz = plotsOriginZ + row * plotSpacing;
      const soil = MeshBuilder.CreateBox(`soil_${id}_${row}_${col}`, {
        width: plotSize, height: 0.15, depth: plotSize,
      }, scene);
      soil.parent = root;
      soil.position.set(px, 0.08, pz);
      soil.material = soilMat;
      soil.receiveShadows = true;

      // Crops — 4 small stalks per plot
      for (let ci = 0; ci < 4; ci++) {
        const cx = (ci % 2 ? 0.7 : -0.7);
        const cz = (ci < 2 ? 0.7 : -0.7);
        const crop = MeshBuilder.CreateBox(`crop_${id}_${row}_${col}_${ci}`, {
          width: 0.25, height: 0.8, depth: 0.25,
        }, scene);
        crop.parent = root;
        crop.position.set(px + cx, 0.55, pz + cz);
        crop.material = cropMat;
      }
    }
  }

  // ── WELL in the front-right corner ──────────────────────────────────
  const wellX = lotHalfW - 4;
  const wellZ = -lotHalfD + 4;
  const wellBase = MeshBuilder.CreateCylinder(`well_${id}_base`, {
    diameter: 2.2, height: 1.2, tessellation: 16,
  }, scene);
  wellBase.parent = root;
  wellBase.position.set(wellX, 0.6, wellZ);
  wellBase.material = stoneMat;
  wellBase.receiveShadows = true;
  exteriorCasters.push(wellBase);

  // Wooden supports (A-frame) on either side of the well
  for (const side of [-1, 1]) {
    const sup = MeshBuilder.CreateBox(`well_${id}_sup_${side}`, {
      width: 0.2, height: 2.5, depth: 0.2,
    }, scene);
    sup.parent = root;
    sup.position.set(wellX + side * 1.0, 2.2 - 0.4, wellZ);
    sup.rotation.z = side * 0.15;
    sup.material = woodMat;
  }
  // Crossbar over the well
  const cross = MeshBuilder.CreateBox(`well_${id}_cross`, {
    width: 2.6, height: 0.2, depth: 0.2,
  }, scene);
  cross.parent = root;
  cross.position.set(wellX, 3.35, wellZ);
  cross.material = woodMat;
  // Well roof (small gable)
  const wellRoof = buildGableRoof(scene, `well_${id}`, 2.8, 1.4, 0.5, 0.1);
  wellRoof.parent = root;
  wellRoof.position.set(wellX, 3.4, wellZ);
  wellRoof.material = roofMat;
  exteriorCasters.push(wellRoof);
  // Bucket rope + bucket
  const rope = MeshBuilder.CreateCylinder(`well_${id}_rope`, {
    diameter: 0.05, height: 1.5, tessellation: 6,
  }, scene);
  rope.parent = root;
  rope.position.set(wellX, 2.5, wellZ);
  rope.material = darkWoodMat;
  const bucket = MeshBuilder.CreateCylinder(`well_${id}_bucket`, {
    diameter: 0.4, height: 0.35, tessellation: 10,
  }, scene);
  bucket.parent = root;
  bucket.position.set(wellX, 1.6, wellZ);
  bucket.material = darkWoodMat;

  // ── HAYSTACK pile (left side of the lot) ────────────────────────────
  const hayX = -lotHalfW + 3;
  const hayZ = lotHalfD - 4;
  // Base layer of bales
  for (let i = 0; i < 4; i++) {
    const bx = hayX + (i % 2) * 1.3;
    const bz = hayZ + Math.floor(i / 2) * 1.3;
    const bale = MeshBuilder.CreateCylinder(`hay_${id}_${i}`, {
      diameter: 1.2, height: 1.2, tessellation: 14,
    }, scene);
    bale.parent = root;
    bale.rotation.z = Math.PI / 2; // lay on side
    bale.position.set(bx, 0.6, bz);
    bale.material = hayMat;
    bale.receiveShadows = true;
    exteriorCasters.push(bale);
  }
  // Top bale centered on the stack
  const topBale = MeshBuilder.CreateCylinder(`hay_${id}_top`, {
    diameter: 1.2, height: 1.2, tessellation: 14,
  }, scene);
  topBale.parent = root;
  topBale.rotation.z = Math.PI / 2;
  topBale.position.set(hayX + 0.65, 1.8, hayZ + 0.65);
  topBale.material = hayMat;
  topBale.receiveShadows = true;
  exteriorCasters.push(topBale);

  // ── WHEELBARROW near the barn ────────────────────────────────────────
  const wbX = barnRoot.position.x + barnW / 2 - 4;
  const wbZ = -barnD / 2 - 2 + barnOffsetZ;
  const wbBed = MeshBuilder.CreateBox(`wb_${id}_bed`, {
    width: 0.9, height: 0.3, depth: 0.6,
  }, scene);
  wbBed.parent = root;
  wbBed.position.set(wbX, 0.55, wbZ);
  wbBed.material = metalRedMat;
  wbBed.receiveShadows = true;
  exteriorCasters.push(wbBed);
  // Handles
  for (const side of [-1, 1]) {
    const h = MeshBuilder.CreateBox(`wb_${id}_h_${side}`, {
      width: 0.08, height: 0.08, depth: 1.3,
    }, scene);
    h.parent = root;
    h.position.set(wbX + side * 0.25, 0.5, wbZ + 0.8);
    h.material = woodMat;
  }
  // Wheel
  const wheel = MeshBuilder.CreateCylinder(`wb_${id}_w`, {
    diameter: 0.5, height: 0.12, tessellation: 12,
  }, scene);
  wheel.parent = root;
  wheel.rotation.z = Math.PI / 2;
  wheel.position.set(wbX, 0.25, wbZ - 0.5);
  wheel.material = darkWoodMat;

  // ── WOODEN PERIMETER FENCE around the lot ───────────────────────────
  const fenceH = 1.2;
  const fenceY = 0.1;
  // 4 edges of the lot
  buildFenceRun(scene, `${id}_fs`, root, -lotHalfW, -lotHalfD, -6, -lotHalfD, fenceH, woodMat); // front-left (leave gap for entry path)
  buildFenceRun(scene, `${id}_fs2`, root, 6, -lotHalfD, lotHalfW, -lotHalfD, fenceH, woodMat);  // front-right
  buildFenceRun(scene, `${id}_bs`, root, -lotHalfW, lotHalfD, lotHalfW, lotHalfD, fenceH, woodMat); // back
  buildFenceRun(scene, `${id}_ls`, root, -lotHalfW, -lotHalfD, -lotHalfW, lotHalfD, fenceH, woodMat); // left
  buildFenceRun(scene, `${id}_rs`, root, lotHalfW, -lotHalfD, lotHalfW, lotHalfD, fenceH, woodMat); // right
  void fenceY;

  // ── Interior furniture ──────────────────────────────────────────────
  // Offset into barn coords
  const furn = buildFurniture(scene, id, 'farm', Math.min(barnW, barnD) - spec.wallThickness * 2, wallH);
  furn.root.parent = barnRoot;

  // Roof meshes = everything decorative (not walls). The interior shell
  // pushed wallsAdded entries; everything else goes in roofMeshes.
  const roofMeshes: AbstractMesh[] = [
    shell.ceiling,
    roof, ridge,
    // silos + caps are pushed last, but we want them to fade too
  ];
  // All exterior casters AFTER the wall count belong to roof/decor — but
  // many of them are LOW (crops, plots, fence, wheelbarrow). The fade
  // should only target things above ~3u. Filter by height:
  for (const m of exteriorCasters.slice(shell.wallsAdded)) {
    if (roofMeshes.includes(m)) continue;
    const y = m.getAbsolutePosition().y;
    if (isRoofMesh(m.name) || y > 2.5) roofMeshes.push(m);
  }

  return {
    root,
    exteriorCasters,
    collisionWalls,
    roofMeshes,
    centerXZ: [position.x + barnRoot.position.x, position.z + barnOffsetZ],
    halfExtentsXZ: [barnW / 2, barnD / 2],
    interiorHeight: wallH, // use the BARN footprint for the "inside" check
  };
}
