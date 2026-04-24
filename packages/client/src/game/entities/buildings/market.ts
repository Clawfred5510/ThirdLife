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
 * MARKET composition:
 * - Central covered pavilion (28×22) with flat canopy on 4 big pillars
 * - Central fountain in front of the entrance
 * - 5 vendor stalls with striped awnings arranged around the plaza
 * - String of light-bulb spheres along the canopy edge
 * - Flagpole with a pennant on top of the pavilion
 * - Cobblestone plaza ground
 */
export function buildMarket(
  scene: Scene,
  id: string | number,
  position: Vector3,
  spec: BuildingSpec,
): BuildingOutput {
  const root = new TransformNode(`market_${id}`, scene);
  root.position.copyFrom(position);

  const lotW = 36;
  const lotD = 32;
  const lotHalfW = lotW / 2;
  const lotHalfD = lotD / 2;

  const pavW = 24;
  const pavD = 18;
  const wallH = spec.wallHeight;

  const exteriorCasters: AbstractMesh[] = [];
  const collisionWalls: AbstractMesh[] = [];

  const wallMat = mat(scene, 'mk-wall', '#E8D8A8', 0.88);
  const trimMat = mat(scene, 'mk-trim', '#3A2A1F', 0.6);
  const roofMat = mat(scene, 'mk-roof', '#5A6F3F', 0.75);
  const whiteMat = mat(scene, 'mk-white', '#F0EAD8', 0.7);
  const cobbleMat = mat(scene, 'cobble', '#9A8E7A', 0.92);
  const waterMat = mat(scene, 'water', '#62A8C0', 0.1, { metallic: 0.25, alpha: 0.75, emissive: new Color3(0.05, 0.1, 0.15) });
  const bulbMat = mat(scene, 'bulb', '#F4CE5A', 0.2, { emissive: new Color3(0.8, 0.55, 0.15) });
  const flagMat = mat(scene, 'pennant', '#D63A3A', 0.85);

  const body = new TransformNode(`mkBody_${id}`, scene);
  body.parent = root;

  const shell = buildInteriorShell(
    scene, id, body, spec,
    pavW, pavD,
    exteriorCasters, collisionWalls,
    wallMat, trimMat,
  );

  // ── CANOPY / FLAT ROOF with wide overhang ───────────────────────────
  const overhang = 2.5;
  const canopy = MeshBuilder.CreateBox(`mkCanopy_${id}`, {
    width: pavW + overhang * 2, height: 0.4, depth: pavD + overhang * 2,
  }, scene);
  canopy.parent = body;
  canopy.position.y = wallH + 0.2;
  canopy.material = roofMat;
  canopy.receiveShadows = true;
  exteriorCasters.push(canopy);

  // 4 big front pillars supporting the canopy overhang
  for (const sx of [-pavW / 2 - 1, pavW / 2 + 1]) {
    for (const sz of [-pavD / 2 - 1, pavD / 2 + 1]) {
      const pillar = MeshBuilder.CreateCylinder(`mkPillar_${id}_${sx}_${sz}`, {
        diameter: 1.0, height: wallH, tessellation: 16,
      }, scene);
      pillar.parent = body;
      pillar.position.set(sx, wallH / 2, sz);
      pillar.material = whiteMat;
      pillar.receiveShadows = true;
      exteriorCasters.push(pillar);
    }
  }

  // ── LIGHT STRING along the front overhang edge ──────────────────────
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    const bx = -(pavW / 2 + overhang) + t * (pavW + overhang * 2);
    const bulb = MeshBuilder.CreateSphere(`mkBulb_${id}_${i}`, {
      diameter: 0.4, segments: 8,
    }, scene);
    bulb.parent = body;
    bulb.position.set(bx, wallH + 0.1, -pavD / 2 - overhang + 0.2);
    bulb.material = bulbMat;
  }

  // ── FLAGPOLE with pennant on top of the canopy ──────────────────────
  const pole = MeshBuilder.CreateCylinder(`mkPole_${id}`, {
    diameter: 0.15, height: 4, tessellation: 8,
  }, scene);
  pole.parent = body;
  pole.position.set(0, wallH + 2.4, 0);
  pole.material = trimMat;
  exteriorCasters.push(pole);
  const pennant = MeshBuilder.CreateBox(`mkPennant_${id}`, {
    width: 1.0, height: 0.5, depth: 0.03,
  }, scene);
  pennant.parent = body;
  pennant.position.set(0.55, wallH + 4.0, 0);
  pennant.material = flagMat;

  // ── 5 VENDOR STALLS arranged around the front plaza ─────────────────
  const stallColors = ['#D63A3A', '#5AAF5A', '#E8A030', '#3A7FBF', '#B060B0'];
  for (let i = 0; i < 5; i++) {
    const angle = (i / 4) * Math.PI * 0.8 - Math.PI * 0.4;
    const dist = 10;
    const sx = Math.sin(angle) * dist;
    const sz = -lotHalfD + 6 + Math.cos(angle) * -2;
    const stallRoot = new TransformNode(`stallRoot_${id}_${i}`, scene);
    stallRoot.parent = root;
    stallRoot.position.set(sx, 0, sz);
    stallRoot.rotation.y = angle * 0.3;
    // Counter
    const counter = MeshBuilder.CreateBox(`stallCounter_${id}_${i}`, {
      width: 1.8, height: 0.9, depth: 0.9,
    }, scene);
    counter.parent = stallRoot;
    counter.position.y = 0.45;
    counter.material = mat(scene, 'stall-wood', '#9A6838', 0.85);
    counter.receiveShadows = true;
    exteriorCasters.push(counter);
    // Produce atop the counter (colored)
    const produce = MeshBuilder.CreateBox(`stallPro_${id}_${i}`, {
      width: 1.4, height: 0.35, depth: 0.6,
    }, scene);
    produce.parent = stallRoot;
    produce.position.y = 1.05;
    produce.material = mat(scene, `stall-p${i}`, stallColors[i], 0.8);
    // 4 corner poles for the awning
    for (const px of [-0.8, 0.8]) {
      for (const pz_ of [-0.4, 0.4]) {
        const p = MeshBuilder.CreateCylinder(`stallPole_${id}_${i}_${px}_${pz_}`, {
          diameter: 0.08, height: 2.2, tessellation: 6,
        }, scene);
        p.parent = stallRoot;
        p.position.set(px, 1.1, pz_);
        p.material = trimMat;
      }
    }
    // Striped awning — 3 horizontal stripes
    for (let s = 0; s < 3; s++) {
      const stripe = MeshBuilder.CreateBox(`stallStrip_${id}_${i}_${s}`, {
        width: 2.0, height: 0.12, depth: 0.3,
      }, scene);
      stripe.parent = stallRoot;
      stripe.position.set(0, 2.25, -0.4 + s * 0.3);
      stripe.material = s % 2 === 0
        ? mat(scene, `stall-stripe-a-${i}`, stallColors[i], 0.7)
        : whiteMat;
    }
  }

  // ── CENTRAL FOUNTAIN in front of the pavilion ───────────────────────
  const fountX = 0;
  const fountZ = -lotHalfD + 6;
  const fountBase = MeshBuilder.CreateCylinder(`mkFountBase_${id}`, {
    diameter: 4.0, height: 0.8, tessellation: 24,
  }, scene);
  fountBase.parent = root;
  fountBase.position.set(fountX, 0.4, fountZ);
  fountBase.material = cobbleMat;
  fountBase.receiveShadows = true;
  exteriorCasters.push(fountBase);
  // Water disc
  const water = MeshBuilder.CreateCylinder(`mkWater_${id}`, {
    diameter: 3.6, height: 0.1, tessellation: 24,
  }, scene);
  water.parent = root;
  water.position.set(fountX, 0.85, fountZ);
  water.material = waterMat;
  // Center plinth + top sphere
  const plinth = MeshBuilder.CreateCylinder(`mkPlinth_${id}`, {
    diameter: 0.8, height: 1.8, tessellation: 16,
  }, scene);
  plinth.parent = root;
  plinth.position.set(fountX, 1.8, fountZ);
  plinth.material = cobbleMat;
  exteriorCasters.push(plinth);
  const topSphere = MeshBuilder.CreateSphere(`mkFountTop_${id}`, {
    diameter: 0.9, segments: 12,
  }, scene);
  topSphere.parent = root;
  topSphere.position.set(fountX, 2.9, fountZ);
  topSphere.material = cobbleMat;
  exteriorCasters.push(topSphere);

  // ── COBBLESTONE PLAZA ground in front ───────────────────────────────
  const plaza = MeshBuilder.CreateBox(`mkPlaza_${id}`, {
    width: lotW * 0.9, height: 0.08, depth: lotD * 0.55,
  }, scene);
  plaza.parent = root;
  plaza.position.set(0, 0.12, -lotD * 0.12);
  plaza.material = cobbleMat;
  plaza.receiveShadows = true;

  // Furniture (reuse existing market set — canopy + stalls)
  const furn = buildFurniture(scene, id, 'market', Math.min(pavW, pavD) - spec.wallThickness * 2, wallH);
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
    halfExtentsXZ: [pavW / 2, pavD / 2],
  };
}
