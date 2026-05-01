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
  // Column caps now have a stepped capital (abacus + echinus) and a
  // small "bracket" connector that fuses into the pediment block above,
  // so the columns visibly support the pediment instead of just sitting
  // under it.
  const colSpacing = 4.5;
  for (let i = 0; i < 4; i++) {
    const cx = (i - 1.5) * colSpacing;
    const col = MeshBuilder.CreateCylinder(`bankCol_${id}_${i}`, {
      diameter: 1.0, height: wallH - 0.8, tessellation: 18,
    }, scene);
    col.parent = buildingRoot;
    col.position.set(cx, (wallH - 0.8) / 2 + 0.6, -buildingD / 2 - 1.6);
    col.material = marbleMat;
    col.receiveShadows = true;
    exteriorCasters.push(col);
    // Echinus (rounded transition)
    const ech = MeshBuilder.CreateCylinder(`bankColEch_${id}_${i}`, {
      diameterTop: 1.4, diameterBottom: 1.0, height: 0.18, tessellation: 18,
    }, scene);
    ech.parent = buildingRoot;
    ech.position.set(cx, wallH - 0.29, -buildingD / 2 - 1.6);
    ech.material = marbleMat;
    exteriorCasters.push(ech);
    // Abacus (square capital block — visually fuses with the pediment)
    const abacus = MeshBuilder.CreateBox(`bankColAb_${id}_${i}`, {
      width: 1.6, height: 0.35, depth: 1.6,
    }, scene);
    abacus.parent = buildingRoot;
    abacus.position.set(cx, wallH - 0.025, -buildingD / 2 - 1.6);
    abacus.material = marbleMat;
    exteriorCasters.push(abacus);
  }
  // Pediment (entablature block) atop the columns — wider + deeper so it
  // clearly rests on the abacus blocks below
  const entab = MeshBuilder.CreateBox(`entab_${id}`, {
    width: colSpacing * 4 + 2.2, height: 1.0, depth: 1.6,
  }, scene);
  entab.parent = buildingRoot;
  entab.position.set(0, wallH + 0.3, -buildingD / 2 - 1.6);
  entab.material = marbleMat;
  exteriorCasters.push(entab);

  // ── MARBLE STAIRCASE up to entry ────────────────────────────────────
  // Each step is a solid collider — player must climb up rather than
  // phase straight through. checkCollisions makes the surface walkable
  // via Babylon's moveWithCollisions; the step heights (0.3u each, 4
  // steps total) are within the avatar capsule's step-up tolerance.
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
    step.checkCollisions = true;
    collisionWalls.push(step);
    exteriorCasters.push(step);
  }

  // ── 2 LION STATUES flanking the steps ───────────────────────────────
  // Reads as a sitting/couchant lion: pedestal, oblong body, four legs
  // (front pair extended forward, back pair tucked under), tail curled
  // to the side, mane (larger sphere around the head with two ears).
  // Bronze material, deliberately stylized to match the cozy-cartoon
  // look of the rest of the world rather than a photoreal sculpt.
  const lionOffsetX = colSpacing * 4 / 2 + 2.5; // outside the steps
  for (const sideSign of [-1, 1]) {
    const lx = sideSign * lionOffsetX;
    const lz = -buildingD / 2 - 2.5;
    // Pedestal
    const pedestal = MeshBuilder.CreateBox(`lionPed_${id}_${sideSign}`, {
      width: 1.8, height: 1.6, depth: 1.8,
    }, scene);
    pedestal.parent = buildingRoot;
    pedestal.position.set(lx, 0.8, lz);
    pedestal.material = marbleMat;
    pedestal.receiveShadows = true;
    pedestal.checkCollisions = true;
    collisionWalls.push(pedestal);
    exteriorCasters.push(pedestal);
    // Top of pedestal
    const py = 1.6;
    // Body (oblong) — couchant pose, lying down
    const body = MeshBuilder.CreateSphere(`lionBody_${id}_${sideSign}`, {
      diameter: 1.0, segments: 14,
    }, scene);
    body.parent = buildingRoot;
    body.scaling.set(0.9, 0.7, 1.6);
    body.position.set(lx, py + 0.55, lz);
    body.material = lionMat;
    exteriorCasters.push(body);
    // Front legs — proud forward stance
    for (const fLeg of [-0.3, 0.3]) {
      const leg = MeshBuilder.CreateBox(`lionLegF_${id}_${sideSign}_${fLeg}`, {
        width: 0.18, height: 0.55, depth: 0.22,
      }, scene);
      leg.parent = buildingRoot;
      leg.position.set(lx + fLeg, py + 0.275, lz - 0.6);
      leg.material = lionMat;
      exteriorCasters.push(leg);
      // Paw block at the bottom front
      const paw = MeshBuilder.CreateBox(`lionPawF_${id}_${sideSign}_${fLeg}`, {
        width: 0.22, height: 0.12, depth: 0.32,
      }, scene);
      paw.parent = buildingRoot;
      paw.position.set(lx + fLeg, py + 0.06, lz - 0.7);
      paw.material = lionMat;
      exteriorCasters.push(paw);
    }
    // Back legs — tucked under body
    for (const bLeg of [-0.3, 0.3]) {
      const leg = MeshBuilder.CreateBox(`lionLegB_${id}_${sideSign}_${bLeg}`, {
        width: 0.22, height: 0.4, depth: 0.5,
      }, scene);
      leg.parent = buildingRoot;
      leg.position.set(lx + bLeg, py + 0.2, lz + 0.45);
      leg.material = lionMat;
      exteriorCasters.push(leg);
    }
    // Tail — curled to one side
    const tail = MeshBuilder.CreateCylinder(`lionTail_${id}_${sideSign}`, {
      diameter: 0.1, height: 0.9, tessellation: 8,
    }, scene);
    tail.parent = buildingRoot;
    tail.rotation.z = 0.4;
    tail.position.set(lx + 0.45, py + 0.7, lz + 0.7);
    tail.material = lionMat;
    exteriorCasters.push(tail);
    // Tail tuft at end
    const tuft = MeshBuilder.CreateSphere(`lionTuft_${id}_${sideSign}`, {
      diameter: 0.2, segments: 8,
    }, scene);
    tuft.parent = buildingRoot;
    tuft.position.set(lx + 0.65, py + 1.05, lz + 0.7);
    tuft.material = lionMat;
    exteriorCasters.push(tuft);
    // Mane — large sphere wrapping the head
    const mane = MeshBuilder.CreateSphere(`lionMane_${id}_${sideSign}`, {
      diameter: 0.95, segments: 14,
    }, scene);
    mane.parent = buildingRoot;
    mane.position.set(lx, py + 0.9, lz - 0.85);
    mane.material = lionMat;
    exteriorCasters.push(mane);
    // Head — slightly smaller, embedded in the mane
    const head = MeshBuilder.CreateSphere(`lionHead_${id}_${sideSign}`, {
      diameter: 0.55, segments: 12,
    }, scene);
    head.parent = buildingRoot;
    head.position.set(lx, py + 0.85, lz - 1.1);
    head.material = lionMat;
    exteriorCasters.push(head);
    // Snout — small box on the front of the head
    const snout = MeshBuilder.CreateBox(`lionSnout_${id}_${sideSign}`, {
      width: 0.22, height: 0.18, depth: 0.18,
    }, scene);
    snout.parent = buildingRoot;
    snout.position.set(lx, py + 0.8, lz - 1.34);
    snout.material = lionMat;
    exteriorCasters.push(snout);
    // Ears — two small spheres on top of the mane
    for (const eSide of [-0.25, 0.25]) {
      const ear = MeshBuilder.CreateSphere(`lionEar_${id}_${sideSign}_${eSide}`, {
        diameter: 0.18, segments: 8,
      }, scene);
      ear.parent = buildingRoot;
      ear.position.set(lx + eSide, py + 1.3, lz - 0.9);
      ear.material = lionMat;
      exteriorCasters.push(ear);
    }
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
