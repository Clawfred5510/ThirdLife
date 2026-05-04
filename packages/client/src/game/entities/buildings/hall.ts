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

  // Painted to match gamedesigns/hall.png: cream sandstone with brick
  // accents, charcoal roof (replaces the old metallic-grey), marble
  // pediment, brass detailing, red flag.
  const stoneMat = mat(scene, 'hall-stone', '#D7C4A2', 0.88);
  const roofMat = mat(scene, 'hall-roof', '#26201A', 0.6);
  const trimMat = mat(scene, 'hall-trim', '#26201A', 0.6);
  const marbleMat = mat(scene, 'hall-marble', '#E8DEC0', 0.55);
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
  // Tower lowered + lengthened so its bottom embeds deep into the
  // pyramid roof instead of hovering on the very tip. Center is at
  // wallH + peak/2 + height/2 = wallH + peak/2 + 2.75 → bottom at wallH
  // (level with eaves), top at wallH + peak + 5.5 - peak/2 ≈ wallH + 4.
  const towerH = 5.5;
  const towerBaseY = wallH + peak * 0.4 + towerH / 2;
  const towerBase = MeshBuilder.CreateBox(`towerBase_${id}`, {
    width: 3.5, height: towerH, depth: 3.5,
  }, scene);
  towerBase.parent = body;
  towerBase.position.y = towerBaseY;
  towerBase.material = stoneMat;
  towerBase.receiveShadows = true;
  exteriorCasters.push(towerBase);
  // Clock face on the front of the tower (south-facing)
  const clockY = towerBaseY + towerH / 2 - 1.4;
  const clock = MeshBuilder.CreateCylinder(`clockFace_${id}`, {
    diameter: 2.4, height: 0.15, tessellation: 24,
  }, scene);
  clock.parent = body;
  clock.rotation.x = Math.PI / 2;
  clock.position.set(0, clockY, -1.78);
  clock.material = marbleMat;
  exteriorCasters.push(clock);
  // Clock hands — push to exteriorCasters so they enter the roof-fade
  // list and disappear with the rest of the tower when the player walks
  // inside (was missing before, the hands persisted indoors).
  const hourHand = MeshBuilder.CreateBox(`clockHourHand_${id}`, {
    width: 0.12, height: 0.6, depth: 0.05,
  }, scene);
  hourHand.parent = body;
  hourHand.rotation.z = 0.3;
  hourHand.position.set(0, clockY + 0.25, -1.88);
  hourHand.material = trimMat;
  exteriorCasters.push(hourHand);
  const minHand = MeshBuilder.CreateBox(`clockMinHand_${id}`, {
    width: 0.08, height: 0.9, depth: 0.05,
  }, scene);
  minHand.parent = body;
  minHand.rotation.z = -0.5;
  minHand.position.set(0, clockY - 0.05, -1.88);
  minHand.material = trimMat;
  exteriorCasters.push(minHand);
  // Tower pyramid cap (above the tower base)
  const towerCap = buildPyramidRoof(scene, `tower_${id}`, 3.7, 3.7, 2.5, 0.1);
  towerCap.parent = body;
  towerCap.position.y = towerBaseY + towerH / 2;
  towerCap.material = roofMat;
  finishRoof(towerCap, roofMat, exteriorCasters);
  // Spire
  const spire = MeshBuilder.CreateCylinder(`spire_${id}`, {
    diameter: 0.15, height: 1.8, tessellation: 8,
  }, scene);
  spire.parent = body;
  spire.position.y = towerBaseY + towerH / 2 + 2.5 + 0.9;
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

  // ── ENTABLATURE + ENTRANCE AWNING above columns ─────────────────────
  // Replaces a broken pediment hack (a tessellation=3 cylinder rotated
  // weirdly that read as a "sideways triangle"). Now a clean classical
  // entablature block sitting on the columns + a slim flat awning slab
  // projecting forward over the entrance with two diagonal supports.
  const pedW = colSpan + 2.5;
  const pedestal = MeshBuilder.CreateBox(`pedBase_${id}`, {
    width: pedW + 1, height: 0.6, depth: 1.4,
  }, scene);
  pedestal.parent = body;
  pedestal.position.set(0, wallH + 0.1, -buildingD / 2 - 1.2);
  pedestal.material = marbleMat;
  exteriorCasters.push(pedestal);
  // Decorative top moulding
  const topMould = MeshBuilder.CreateBox(`pedTop_${id}`, {
    width: pedW + 1.4, height: 0.25, depth: 1.6,
  }, scene);
  topMould.parent = body;
  topMould.position.set(0, wallH + 0.55, -buildingD / 2 - 1.2);
  topMould.material = marbleMat;
  exteriorCasters.push(topMould);
  // Awning over the entrance — projects forward (-Z) from the building
  // wall. Slim slab at door-height-plus, supported by two diagonal stays.
  const awningW = spec.doorWidth + 4;
  const awningD = 2.0;
  const awningY = spec.doorHeight + 0.6;
  const awningSlab = MeshBuilder.CreateBox(`hallAwning_${id}`, {
    width: awningW, height: 0.18, depth: awningD,
  }, scene);
  awningSlab.parent = body;
  awningSlab.position.set(0, awningY, -buildingD / 2 - awningD / 2 - 0.3);
  awningSlab.material = bronzeMat;
  exteriorCasters.push(awningSlab);
  // Two diagonal support stays from the wall up to the awning's outer corners
  for (const sx of [-1, 1]) {
    const stayLen = Math.hypot(awningD - 0.3, 0.8);
    const stay = MeshBuilder.CreateBox(`hallAwningStay_${id}_${sx}`, {
      width: 0.12, height: stayLen, depth: 0.12,
    }, scene);
    stay.parent = body;
    // Anchor at the wall (y=awningY-0.8, z=-buildingD/2), tip at outer corner
    stay.rotation.x = Math.atan2(awningD - 0.3, 0.8);
    stay.position.set(sx * (awningW / 2 - 0.4), awningY - 0.4, -buildingD / 2 - (awningD - 0.3) / 2 - 0.3);
    stay.material = bronzeMat;
    exteriorCasters.push(stay);
  }

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
