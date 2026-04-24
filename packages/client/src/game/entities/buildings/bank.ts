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
import { buildDome, finishRoof } from './roofPrimitives';

/**
 * BANK composition:
 * - Stone classical building with central dome, 4 front columns
 * - 2 corner turrets at front corners (each capped with small dome)
 * - Wide marble staircase up to entry
 * - 2 lion statues flanking the steps
 * - Gold cornice band at the roofline
 * - ATM kiosk to one side outside
 * - Pediment block above the columns
 */
export function buildBank(
  scene: Scene,
  id: string | number,
  position: Vector3,
  spec: BuildingSpec,
): BuildingOutput {
  const root = new TransformNode(`bank_${id}`, scene);
  root.position.copyFrom(position);

  const lotW = 36;
  const lotD = 32;
  const lotHalfW = lotW / 2;
  const lotHalfD = lotD / 2;

  const buildingW = 28;
  const buildingD = 22;
  const offsetZ = 2;
  const wallH = spec.wallHeight;

  const exteriorCasters: AbstractMesh[] = [];
  const collisionWalls: AbstractMesh[] = [];

  // Materials — classical stone palette
  const stoneMat = mat(scene, 'bank-stone', '#E0D9C4', 0.88);
  const marbleMat = mat(scene, 'marble', '#F0EAD8', 0.5, { metallic: 0.05 });
  const goldMat = mat(scene, 'gold', '#D4A847', 0.35, { metallic: 0.6 });
  const trimMat = mat(scene, 'bank-trim', '#3A2A20', 0.55);
  const domeMat = mat(scene, 'dome-copper', '#8FAE9A', 0.5, { metallic: 0.4 });
  const lionMat = mat(scene, 'lion-bronze', '#7A5A3A', 0.6, { metallic: 0.5 });

  const buildingRoot = new TransformNode(`bankBody_${id}`, scene);
  buildingRoot.parent = root;
  buildingRoot.position.set(0, 0, offsetZ);

  // ── SHELL ───────────────────────────────────────────────────────────
  const shell = buildInteriorShell(
    scene, id, buildingRoot, spec,
    buildingW, buildingD,
    exteriorCasters, collisionWalls,
    stoneMat, trimMat,
  );

  // ── FLAT ROOF SLAB ──────────────────────────────────────────────────
  const slab = MeshBuilder.CreateBox(`bankSlab_${id}`, {
    width: buildingW + 0.6, height: 0.4, depth: buildingD + 0.6,
  }, scene);
  slab.parent = buildingRoot;
  slab.position.y = wallH + 0.2;
  slab.material = stoneMat;
  finishRoof(slab, stoneMat, exteriorCasters);

  // ── GOLD CORNICE BAND at roofline ───────────────────────────────────
  const cornice = MeshBuilder.CreateBox(`cornice_${id}`, {
    width: buildingW + 1.0, height: 0.5, depth: buildingD + 1.0,
  }, scene);
  cornice.parent = buildingRoot;
  cornice.position.y = wallH + 0.05;
  cornice.material = goldMat;
  exteriorCasters.push(cornice);

  // ── CENTRAL DOME ────────────────────────────────────────────────────
  const domeDiam = buildingW * 0.45;
  const dome = buildDome(scene, `bank_${id}`, domeDiam, 1.0);
  dome.parent = buildingRoot;
  dome.position.y = wallH + 0.5;
  dome.material = domeMat;
  finishRoof(dome, domeMat, exteriorCasters);
  // Dome lantern (small cylinder + sphere on top)
  const lantern = MeshBuilder.CreateCylinder(`bankLantern_${id}`, {
    diameter: 1.4, height: 1.6, tessellation: 12,
  }, scene);
  lantern.parent = buildingRoot;
  lantern.position.y = wallH + 0.5 + domeDiam / 2 * 1.0 + 0.8;
  lantern.material = goldMat;
  exteriorCasters.push(lantern);
  const lantTop = MeshBuilder.CreateSphere(`bankLantTop_${id}`, { diameter: 0.6, segments: 10 }, scene);
  lantTop.parent = buildingRoot;
  lantTop.position.y = wallH + 0.5 + domeDiam / 2 * 1.0 + 1.7;
  lantTop.material = goldMat;
  exteriorCasters.push(lantTop);

  // ── 2 CORNER TURRETS at front corners ───────────────────────────────
  for (const tx of [-buildingW / 2 + 1.5, buildingW / 2 - 1.5]) {
    const turret = MeshBuilder.CreateCylinder(`turret_${id}_${tx}`, {
      diameter: 2.6, height: wallH + 1.5, tessellation: 16,
    }, scene);
    turret.parent = buildingRoot;
    turret.position.set(tx, (wallH + 1.5) / 2, -buildingD / 2 + 0.4);
    turret.material = stoneMat;
    turret.receiveShadows = true;
    exteriorCasters.push(turret);
    const turretCap = buildDome(scene, `turCap_${id}_${tx}`, 2.6, 0.85);
    turretCap.parent = buildingRoot;
    turretCap.position.set(tx, wallH + 1.5, -buildingD / 2 + 0.4);
    turretCap.material = domeMat;
    finishRoof(turretCap, domeMat, exteriorCasters);
  }

  // ── 4 FRONT COLUMNS + PEDIMENT ──────────────────────────────────────
  const colSpacing = 4.5;
  for (let i = 0; i < 4; i++) {
    const cx = (i - 1.5) * colSpacing;
    const col = MeshBuilder.CreateCylinder(`bankCol_${id}_${i}`, {
      diameter: 1.0, height: wallH - 0.6, tessellation: 18,
    }, scene);
    col.parent = buildingRoot;
    col.position.set(cx, (wallH - 0.6) / 2 + 0.6, -buildingD / 2 - 1.6);
    col.material = marbleMat;
    col.receiveShadows = true;
    exteriorCasters.push(col);
    const cap = MeshBuilder.CreateCylinder(`bankColCap_${id}_${i}`, {
      diameter: 1.4, height: 0.3, tessellation: 18,
    }, scene);
    cap.parent = buildingRoot;
    cap.position.set(cx, wallH - 0.15, -buildingD / 2 - 1.6);
    cap.material = marbleMat;
    exteriorCasters.push(cap);
  }
  // Pediment (entablature block) atop the columns
  const entab = MeshBuilder.CreateBox(`entab_${id}`, {
    width: colSpacing * 4 + 1.5, height: 0.8, depth: 1.2,
  }, scene);
  entab.parent = buildingRoot;
  entab.position.set(0, wallH + 0.4, -buildingD / 2 - 1.6);
  entab.material = marbleMat;
  exteriorCasters.push(entab);

  // ── MARBLE STAIRCASE up to entry ────────────────────────────────────
  const stepCount = 4;
  for (let s = 0; s < stepCount; s++) {
    const stepW = colSpacing * 4 + 2 - s * 0.4;
    const step = MeshBuilder.CreateBox(`bankStep_${id}_${s}`, {
      width: stepW, height: 0.3, depth: 1.2 - s * 0.2,
    }, scene);
    step.parent = buildingRoot;
    step.position.set(0, 0.15 + s * 0.3, -buildingD / 2 - 2.5 + s * 0.3);
    step.material = marbleMat;
    step.receiveShadows = true;
    exteriorCasters.push(step);
  }

  // ── 2 LION STATUES flanking the steps ───────────────────────────────
  for (const lx of [-stepCount * 1.0 - 4, stepCount * 1.0 + 4]) {
    const pedestal = MeshBuilder.CreateBox(`lionPed_${id}_${lx}`, {
      width: 1.6, height: 1.4, depth: 1.6,
    }, scene);
    pedestal.parent = buildingRoot;
    pedestal.position.set(lx, 0.7, -buildingD / 2 - 2.5);
    pedestal.material = marbleMat;
    pedestal.receiveShadows = true;
    exteriorCasters.push(pedestal);
    // Lion body (oblong sphere)
    const body = MeshBuilder.CreateSphere(`lionBody_${id}_${lx}`, { diameter: 1.4, segments: 14 }, scene);
    body.parent = buildingRoot;
    body.scaling.set(1.0, 0.9, 1.6);
    body.position.set(lx, 1.95, -buildingD / 2 - 2.5);
    body.material = lionMat;
    exteriorCasters.push(body);
    // Lion head
    const head = MeshBuilder.CreateSphere(`lionHead_${id}_${lx}`, { diameter: 0.9, segments: 12 }, scene);
    head.parent = buildingRoot;
    head.position.set(lx, 2.4, -buildingD / 2 - 3.4);
    head.material = lionMat;
    exteriorCasters.push(head);
  }

  // ── ATM KIOSK (right side) ──────────────────────────────────────────
  const atmRoot = new TransformNode(`atmRoot_${id}`, scene);
  atmRoot.parent = root;
  atmRoot.position.set(lotHalfW - 3, 0, -lotHalfD + 4);
  const atmBody = MeshBuilder.CreateBox(`atm_${id}_body`, { width: 1.4, height: 2.2, depth: 0.9 }, scene);
  atmBody.parent = atmRoot;
  atmBody.position.y = 1.1;
  atmBody.material = trimMat;
  atmBody.receiveShadows = true;
  exteriorCasters.push(atmBody);
  const atmScreen = MeshBuilder.CreateBox(`atm_${id}_screen`, { width: 0.9, height: 0.6, depth: 0.05 }, scene);
  atmScreen.parent = atmRoot;
  atmScreen.position.set(0, 1.6, -0.5);
  atmScreen.material = mat(scene, 'screen-glow', '#54B0E0', 0.2, { emissive: new Color3(0.25, 0.45, 0.65) });
  // Roof over ATM
  const atmRoof = MeshBuilder.CreateBox(`atm_${id}_roof`, { width: 2.0, height: 0.2, depth: 1.5 }, scene);
  atmRoof.parent = atmRoot;
  atmRoof.position.y = 2.4;
  atmRoof.material = stoneMat;

  // Furniture
  const furn = buildFurniture(scene, id, 'bank', Math.min(buildingW, buildingD) - spec.wallThickness * 2, wallH);
  furn.root.parent = buildingRoot;

  const roofMeshes: AbstractMesh[] = [shell.ceiling];
  for (const m of exteriorCasters.slice(shell.wallsAdded)) {
    if (m.getAbsolutePosition().y > 2.5) roofMeshes.push(m);
  }

  return {
    root,
    exteriorCasters,
    collisionWalls,
    roofMeshes,
    centerXZ: [position.x, position.z + offsetZ],
    halfExtentsXZ: [buildingW / 2, buildingD / 2],
  };
}
