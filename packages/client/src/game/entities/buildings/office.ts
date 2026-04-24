import {
  Scene,
  MeshBuilder,
  Vector3,
  Color3,
  TransformNode,
  AbstractMesh,
} from '@babylonjs/core';
import { buildFurniture } from '../buildingFurniture';
import { BuildingSpec, BuildingOutput, buildInteriorShell, mat } from './shared';

/**
 * OFFICE composition:
 * - Tall 13u corporate tower (26×22) with flat roof + parapet
 * - Mid-height horizontal glass band (curtain-wall reference)
 * - Rooftop mechanical penthouse
 * - Satellite dish on the penthouse
 * - Cantilevered entry blade above the door
 * - Concrete plaza in front with a circular company medallion
 * - 2 benches flanking the plaza
 * - Bike rack to the side
 * - Small planter boxes by the entrance
 */
export function buildOffice(
  scene: Scene,
  id: string | number,
  position: Vector3,
  spec: BuildingSpec,
): BuildingOutput {
  const root = new TransformNode(`office_${id}`, scene);
  root.position.copyFrom(position);

  const lotD = 32;
  const lotHalfD = lotD / 2;

  const towerW = 24;
  const towerD = 20;
  const wallH = spec.wallHeight;

  const exteriorCasters: AbstractMesh[] = [];
  const collisionWalls: AbstractMesh[] = [];

  const wallMat = mat(scene, 'office-wall', '#8AA0B8', 0.55, { metallic: 0.2 });
  const trimMat = mat(scene, 'office-trim', '#2A2F38', 0.55);
  const glassMat = mat(scene, 'office-glass', '#A8C8D8', 0.15, { alpha: 0.5, emissive: new Color3(0.15, 0.25, 0.35) });
  const concreteMat = mat(scene, 'office-concrete', '#B5B3AE', 0.9);
  const penthouseMat = mat(scene, 'penthouse', '#4A4F58', 0.65);
  const metalMat = mat(scene, 'office-metal', '#8E9098', 0.4, { metallic: 0.55 });
  const plantMat = mat(scene, 'office-plant', '#3A7A3A', 0.95);
  const medallion = mat(scene, 'medallion', '#D4A847', 0.35, { metallic: 0.55 });

  const body = new TransformNode(`officeBody_${id}`, scene);
  body.parent = root;

  const shell = buildInteriorShell(
    scene, id, body, spec,
    towerW, towerD,
    exteriorCasters, collisionWalls,
    wallMat, trimMat,
  );

  // ── FLAT ROOF + PARAPET ─────────────────────────────────────────────
  const flat = MeshBuilder.CreateBox(`officeRoof_${id}`, {
    width: towerW + 0.5, height: 0.35, depth: towerD + 0.5,
  }, scene);
  flat.parent = body;
  flat.position.y = wallH + 0.175;
  flat.material = trimMat;
  exteriorCasters.push(flat);
  // Parapet rim
  const parW = towerW + 0.5;
  const parD = towerD + 0.5;
  for (const [w2, d2, x2, z2] of [
    [parW, 0.3, 0, parD / 2 + 0.15],
    [parW, 0.3, 0, -parD / 2 - 0.15],
    [0.3, parD + 0.6, parW / 2 + 0.15, 0],
    [0.3, parD + 0.6, -parW / 2 - 0.15, 0],
  ] as const) {
    const seg = MeshBuilder.CreateBox(`parapet_${id}_${x2}_${z2}`, { width: w2, height: 0.8, depth: d2 }, scene);
    seg.parent = body;
    seg.position.set(x2, wallH + 0.75, z2);
    seg.material = trimMat;
    exteriorCasters.push(seg);
  }

  // ── MID-HEIGHT GLASS BAND (curtain-wall reference) ──────────────────
  const bandY = wallH * 0.45;
  const bandH = 1.2;
  for (const [bw, bd, bx, bz] of [
    [towerW * 0.95, 0.2, 0, -towerD / 2],
    [towerW * 0.95, 0.2, 0, towerD / 2],
    [0.2, towerD * 0.95, -towerW / 2, 0],
    [0.2, towerD * 0.95, towerW / 2, 0],
  ] as const) {
    const band = MeshBuilder.CreateBox(`glassBand_${id}_${bx}_${bz}`, {
      width: bw, height: bandH, depth: bd,
    }, scene);
    band.parent = body;
    band.position.set(bx, bandY, bz);
    band.material = glassMat;
  }

  // ── ROOFTOP MECHANICAL PENTHOUSE ────────────────────────────────────
  const penthouse = MeshBuilder.CreateBox(`penthouse_${id}`, {
    width: towerW * 0.45, height: 3.2, depth: towerD * 0.45,
  }, scene);
  penthouse.parent = body;
  penthouse.position.set(0, wallH + 2.0, towerD * 0.15);
  penthouse.material = penthouseMat;
  penthouse.receiveShadows = true;
  exteriorCasters.push(penthouse);

  // ── SATELLITE DISH on the penthouse ─────────────────────────────────
  const dishBase = MeshBuilder.CreateCylinder(`dishBase_${id}`, {
    diameter: 0.3, height: 0.9, tessellation: 8,
  }, scene);
  dishBase.parent = body;
  dishBase.position.set(towerW * 0.15, wallH + 4.2, towerD * 0.25);
  dishBase.material = metalMat;
  const dish = MeshBuilder.CreateSphere(`dish_${id}`, {
    diameter: 1.4, segments: 14, arc: 1, slice: 0.5,
  }, scene);
  dish.parent = body;
  dish.scaling.y = 0.3;
  dish.rotation.x = -0.5;
  dish.position.set(towerW * 0.15, wallH + 4.8, towerD * 0.25);
  dish.material = metalMat;
  exteriorCasters.push(dish);

  // ── CANTILEVERED ENTRY BLADE above the door ─────────────────────────
  const blade = MeshBuilder.CreateBox(`officeEntry_${id}`, {
    width: 7, height: 0.25, depth: 2.5,
  }, scene);
  blade.parent = body;
  blade.position.set(0, spec.doorHeight + 0.5, -towerD / 2 - 1.0);
  blade.material = trimMat;
  blade.receiveShadows = true;
  exteriorCasters.push(blade);

  // ── CONCRETE PLAZA in front ─────────────────────────────────────────
  const plaza = MeshBuilder.CreateBox(`officePlaza_${id}`, {
    width: 24, height: 0.12, depth: 8,
  }, scene);
  plaza.parent = root;
  plaza.position.set(0, 0.12, -towerD / 2 - 5);
  plaza.material = concreteMat;
  plaza.receiveShadows = true;

  // Company medallion embedded in the plaza
  const medal = MeshBuilder.CreateCylinder(`medal_${id}`, {
    diameter: 3.0, height: 0.06, tessellation: 32,
  }, scene);
  medal.parent = root;
  medal.position.set(0, 0.19, -towerD / 2 - 5);
  medal.material = medallion;

  // ── 2 BENCHES flanking the plaza ────────────────────────────────────
  for (const bx of [-9, 9]) {
    const bench = MeshBuilder.CreateBox(`officeBench_${id}_${bx}`, {
      width: 2.2, height: 0.12, depth: 0.5,
    }, scene);
    bench.parent = root;
    bench.position.set(bx, 0.55, -towerD / 2 - 4);
    bench.material = trimMat;
    exteriorCasters.push(bench);
    // Bench support
    for (const lx of [-0.9, 0.9]) {
      const leg = MeshBuilder.CreateBox(`officeBenchLeg_${id}_${bx}_${lx}`, {
        width: 0.12, height: 0.5, depth: 0.45,
      }, scene);
      leg.parent = root;
      leg.position.set(bx + lx, 0.25, -towerD / 2 - 4);
      leg.material = metalMat;
    }
  }

  // ── BIKE RACK to the side ───────────────────────────────────────────
  const rackX = -lotHalfD + 4;
  for (let i = 0; i < 4; i++) {
    const arc = MeshBuilder.CreateTorus(`bikeArc_${id}_${i}`, {
      diameter: 0.8, thickness: 0.08, tessellation: 16,
    }, scene);
    arc.parent = root;
    arc.position.set(-14 + i * 0.9, 0.4, -towerD / 2 - 6);
    arc.material = metalMat;
    exteriorCasters.push(arc);
  }

  // ── PLANTER BOXES flanking the entrance ─────────────────────────────
  for (const pxSide of [-1, 1]) {
    const planter = MeshBuilder.CreateBox(`planter_${id}_${pxSide}`, {
      width: 1.5, height: 0.8, depth: 1.5,
    }, scene);
    planter.parent = body;
    planter.position.set(pxSide * (spec.doorWidth / 2 + 1.5), 0.4, -towerD / 2 - 1.5);
    planter.material = concreteMat;
    exteriorCasters.push(planter);
    // Plant on top
    const plant = MeshBuilder.CreateSphere(`plant_${id}_${pxSide}`, {
      diameter: 1.5, segments: 10,
    }, scene);
    plant.parent = body;
    plant.scaling.y = 0.85;
    plant.position.set(pxSide * (spec.doorWidth / 2 + 1.5), 1.4, -towerD / 2 - 1.5);
    plant.material = plantMat;
  }

  // Furniture
  const furn = buildFurniture(scene, id, 'office', Math.min(towerW, towerD) - spec.wallThickness * 2, wallH);
  furn.root.parent = body;

  const roofMeshes: AbstractMesh[] = [shell.ceiling];
  for (const m of exteriorCasters.slice(shell.wallsAdded)) {
    if (m.getAbsolutePosition().y > 2.5) roofMeshes.push(m);
  }

  return {
    root,
    exteriorCasters,
    collisionWalls,
    roofMeshes,
    centerXZ: [position.x, position.z],
    halfExtentsXZ: [towerW / 2, towerD / 2],
  };
}
