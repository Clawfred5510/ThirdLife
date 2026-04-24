import {
  Scene,
  MeshBuilder,
  Vector3,
  Color3,
  TransformNode,
  AbstractMesh,
} from '@babylonjs/core';
import { buildFurniture } from '../buildingFurniture';
import { BuildingSpec, BuildingOutput, buildInteriorShell, mat, isRoofMesh } from './shared';
import { buildPyramidRoof, finishRoof } from './roofPrimitives';

/**
 * HALL (Town Hall) composition:
 * - Classical stone building (30×24) with pyramid roof
 * - Central clock tower rising from the peak
 * - 4 classical columns across the front
 * - Pediment (triangular) above the columns
 * - Wide marble staircase to entry
 * - Statue on pedestal center-stage
 * - 2 flagpoles with flags on either side of the entrance
 */
export function buildHall(
  scene: Scene,
  id: string | number,
  position: Vector3,
  spec: BuildingSpec,
): BuildingOutput {
  const root = new TransformNode(`hall_${id}`, scene);
  root.position.copyFrom(position);

  const lotW = 36;
  const lotD = 32;
  const lotHalfD = lotD / 2;

  const buildingW = 28;
  const buildingD = 22;
  const offsetZ = 3;
  const wallH = spec.wallHeight;
  const peak = spec.roofPeak;

  const exteriorCasters: AbstractMesh[] = [];
  const collisionWalls: AbstractMesh[] = [];

  const stoneMat = mat(scene, 'hall-stone', '#DDD4BD', 0.88);
  const roofMat = mat(scene, 'hall-roof', '#6F7A82', 0.5, { metallic: 0.35 });
  const trimMat = mat(scene, 'hall-trim', '#2A2018', 0.6);
  const marbleMat = mat(scene, 'hall-marble', '#F0EAD8', 0.55);
  const bronzeMat = mat(scene, 'hall-bronze', '#7A5A3A', 0.6, { metallic: 0.5 });
  const flagMat = mat(scene, 'flag-red', '#B03030', 0.9, { emissive: new Color3(0.08, 0.02, 0.02) });

  const body = new TransformNode(`hallBody_${id}`, scene);
  body.parent = root;
  body.position.z = offsetZ;

  const shell = buildInteriorShell(
    scene, id, body, spec,
    buildingW, buildingD,
    exteriorCasters, collisionWalls,
    stoneMat, trimMat,
  );

  // ── PYRAMID ROOF ───────────────────────────────────────────────────
  const pyr = buildPyramidRoof(scene, id, buildingW, buildingD, peak, 0.5);
  pyr.parent = body;
  pyr.position.y = wallH;
  finishRoof(pyr, roofMat, exteriorCasters);

  // ── CENTRAL CLOCK TOWER ─────────────────────────────────────────────
  const towerBase = MeshBuilder.CreateBox(`towerBase_${id}`, {
    width: 3.5, height: 3.5, depth: 3.5,
  }, scene);
  towerBase.parent = body;
  towerBase.position.y = wallH + peak + 1.75;
  towerBase.material = stoneMat;
  towerBase.receiveShadows = true;
  exteriorCasters.push(towerBase);
  // Clock face on the front
  const clock = MeshBuilder.CreateCylinder(`clockFace_${id}`, {
    diameter: 2.4, height: 0.15, tessellation: 24,
  }, scene);
  clock.parent = body;
  clock.rotation.x = Math.PI / 2;
  clock.position.set(0, wallH + peak + 1.75, -1.75);
  clock.material = marbleMat;
  exteriorCasters.push(clock);
  // Clock hands
  const hourHand = MeshBuilder.CreateBox(`hourHand_${id}`, { width: 0.12, height: 0.6, depth: 0.05 }, scene);
  hourHand.parent = body;
  hourHand.rotation.z = 0.3;
  hourHand.position.set(0, wallH + peak + 2.0, -1.85);
  hourHand.material = trimMat;
  const minHand = MeshBuilder.CreateBox(`minHand_${id}`, { width: 0.08, height: 0.9, depth: 0.05 }, scene);
  minHand.parent = body;
  minHand.rotation.z = -0.5;
  minHand.position.set(0, wallH + peak + 1.7, -1.85);
  minHand.material = trimMat;
  // Tower pyramid cap
  const towerCap = buildPyramidRoof(scene, `tower_${id}`, 3.7, 3.7, 2.5, 0.1);
  towerCap.parent = body;
  towerCap.position.y = wallH + peak + 3.5;
  towerCap.material = roofMat;
  exteriorCasters.push(towerCap);
  // Spire
  const spire = MeshBuilder.CreateCylinder(`spire_${id}`, {
    diameter: 0.15, height: 1.8, tessellation: 8,
  }, scene);
  spire.parent = body;
  spire.position.y = wallH + peak + 6.5;
  spire.material = bronzeMat;
  exteriorCasters.push(spire);

  // ── 4 FRONT COLUMNS ─────────────────────────────────────────────────
  const colSpan = buildingW - 4;
  for (let i = 0; i < 4; i++) {
    const cx = -colSpan / 2 + (colSpan / 3) * i;
    const col = MeshBuilder.CreateCylinder(`hallCol_${id}_${i}`, {
      diameter: 1.2, height: wallH - 0.4, tessellation: 18,
    }, scene);
    col.parent = body;
    col.position.set(cx, (wallH - 0.4) / 2 + 0.4, -buildingD / 2 - 1.2);
    col.material = marbleMat;
    col.receiveShadows = true;
    exteriorCasters.push(col);
    const cap = MeshBuilder.CreateCylinder(`hallColCap_${id}_${i}`, {
      diameter: 1.6, height: 0.4, tessellation: 18,
    }, scene);
    cap.parent = body;
    cap.position.set(cx, wallH - 0.2, -buildingD / 2 - 1.2);
    cap.material = marbleMat;
    exteriorCasters.push(cap);
  }

  // ── TRIANGULAR PEDIMENT above columns ───────────────────────────────
  // A thin triangular prism (gable-shaped) — use our gable primitive scaled thin
  const pedW = colSpan + 2.5;
  const pedestal = MeshBuilder.CreateBox(`pedBase_${id}`, {
    width: pedW + 1, height: 0.6, depth: 1.4,
  }, scene);
  pedestal.parent = body;
  pedestal.position.set(0, wallH + 0.1, -buildingD / 2 - 1.2);
  pedestal.material = marbleMat;
  exteriorCasters.push(pedestal);
  // Triangle block (using a cylinder tessellation=3 on proper orientation)
  const triProm = MeshBuilder.CreateCylinder(`pediment_${id}`, {
    diameterTop: 0, diameterBottom: 2.4, height: pedW, tessellation: 3,
  }, scene);
  triProm.parent = body;
  triProm.rotation.z = Math.PI / 2;
  triProm.rotation.x = Math.PI / 6;
  triProm.scaling.set(1, 0.4, 1);
  triProm.position.set(0, wallH + 1.0, -buildingD / 2 - 1.2);
  triProm.material = marbleMat;
  exteriorCasters.push(triProm);

  // ── WIDE MARBLE STAIRCASE ───────────────────────────────────────────
  for (let s = 0; s < 3; s++) {
    const stepW = colSpan + 5 - s * 0.8;
    const step = MeshBuilder.CreateBox(`hallStep_${id}_${s}`, {
      width: stepW, height: 0.35, depth: 1.5 - s * 0.2,
    }, scene);
    step.parent = body;
    step.position.set(0, 0.175 + s * 0.35, -buildingD / 2 - 2.5 + s * 0.3);
    step.material = marbleMat;
    step.receiveShadows = true;
    exteriorCasters.push(step);
  }

  // ── STATUE on pedestal in front of the hall ─────────────────────────
  const statueX = 0;
  const statueZ = -lotHalfD + 3;
  const statueGlobal = new TransformNode(`statueRoot_${id}`, scene);
  statueGlobal.parent = root;
  statueGlobal.position.set(statueX, 0, statueZ);
  const stBase = MeshBuilder.CreateBox(`statueBase_${id}`, { width: 1.5, height: 1.8, depth: 1.5 }, scene);
  stBase.parent = statueGlobal;
  stBase.position.y = 0.9;
  stBase.material = marbleMat;
  exteriorCasters.push(stBase);
  const stBody = MeshBuilder.CreateCylinder(`statueBody_${id}`, {
    diameterTop: 0.7, diameterBottom: 1.1, height: 2.0, tessellation: 12,
  }, scene);
  stBody.parent = statueGlobal;
  stBody.position.y = 2.8;
  stBody.material = bronzeMat;
  exteriorCasters.push(stBody);
  const stHead = MeshBuilder.CreateSphere(`statueHead_${id}`, { diameter: 0.8, segments: 12 }, scene);
  stHead.parent = statueGlobal;
  stHead.position.y = 4.2;
  stHead.material = bronzeMat;
  exteriorCasters.push(stHead);

  // ── 2 FLAGPOLES with flags ──────────────────────────────────────────
  for (const fxSide of [-1, 1]) {
    const fpX = fxSide * (buildingW / 2 - 1);
    const fpZ = -buildingD / 2 - 1.2;
    const pole = MeshBuilder.CreateCylinder(`flagpole_${id}_${fxSide}`, {
      diameter: 0.15, height: 6, tessellation: 8,
    }, scene);
    pole.parent = body;
    pole.position.set(fpX, 3, fpZ);
    pole.material = bronzeMat;
    exteriorCasters.push(pole);
    const flag = MeshBuilder.CreateBox(`flag_${id}_${fxSide}`, { width: 1.4, height: 0.85, depth: 0.04 }, scene);
    flag.parent = body;
    flag.position.set(fpX + fxSide * 0.75, 5.5, fpZ);
    flag.material = flagMat;
    exteriorCasters.push(flag);
  }

  // Furniture
  const furn = buildFurniture(scene, id, 'hall', Math.min(buildingW, buildingD) - spec.wallThickness * 2, wallH);
  furn.root.parent = body;

  const roofMeshes: AbstractMesh[] = [shell.ceiling];
  for (const m of exteriorCasters.slice(shell.wallsAdded)) {
    if (isRoofMesh(m.name) || m.getAbsolutePosition().y > 2.5) roofMeshes.push(m);
  }

  return {
    root,
    exteriorCasters,
    collisionWalls,
    roofMeshes,
    centerXZ: [position.x, position.z + offsetZ],
    halfExtentsXZ: [buildingW / 2, buildingD / 2],
    interiorHeight: wallH,
  };
}
