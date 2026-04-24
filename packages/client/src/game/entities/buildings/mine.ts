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

/**
 * MINE composition:
 * - Rough stone building with arched mine entrance (24×20)
 * - Tall wooden HEADFRAME over the mine shaft (A-frame with wheels)
 * - Smokestack beside the headframe
 * - Ore carts on rail tracks extending from the entrance
 * - Slag/ore piles around the lot (dark humps)
 * - Pickaxes leaning against walls
 * - Oil lantern post for ambiance
 */
export function buildMine(
  scene: Scene,
  id: string | number,
  position: Vector3,
  spec: BuildingSpec,
): BuildingOutput {
  const root = new TransformNode(`mine_${id}`, scene);
  root.position.copyFrom(position);

  const lotW = 36;
  const lotD = 32;
  const lotHalfW = lotW / 2;
  const lotHalfD = lotD / 2;

  const buildingW = 22;
  const buildingD = 18;
  const wallH = spec.wallHeight;

  const exteriorCasters: AbstractMesh[] = [];
  const collisionWalls: AbstractMesh[] = [];

  const stoneMat = mat(scene, 'mine-stone', '#6A635A', 0.95);
  const trimMat = mat(scene, 'mine-trim', '#3A2E28', 0.75);
  const darkWoodMat = mat(scene, 'mine-wood', '#5A3A22', 0.85);
  const metalMat = mat(scene, 'mine-metal', '#6A6A70', 0.55, { metallic: 0.55 });
  const rustMat = mat(scene, 'mine-rust', '#9A6030', 0.75, { metallic: 0.2 });
  const oreMat = mat(scene, 'ore-dark', '#3A3030', 0.95);
  const oreGlow = mat(scene, 'ore-glow', '#8A5030', 0.7, { emissive: new Color3(0.25, 0.10, 0.04) });
  const dirtMat = mat(scene, 'dirt', '#4A3828', 0.98);
  const lanternMat = mat(scene, 'lantern-glow', '#FFCC66', 0.2, { emissive: new Color3(0.8, 0.6, 0.25) });

  const body = new TransformNode(`mineBody_${id}`, scene);
  body.parent = root;

  const shell = buildInteriorShell(
    scene, id, body, spec,
    buildingW, buildingD,
    exteriorCasters, collisionWalls,
    stoneMat, trimMat,
  );

  // ── FLAT ROOF with corrugated ridges ────────────────────────────────
  const roof = MeshBuilder.CreateBox(`mineRoof_${id}`, {
    width: buildingW + 0.4, height: 0.3, depth: buildingD + 0.4,
  }, scene);
  roof.parent = body;
  roof.position.y = wallH + 0.15;
  roof.material = trimMat;
  roof.receiveShadows = true;
  exteriorCasters.push(roof);
  // 3 corrugated ridges
  for (let i = 0; i < 3; i++) {
    const ridge = MeshBuilder.CreateBox(`corrug_${id}_${i}`, {
      width: buildingW + 0.3, height: 0.15, depth: 0.4,
    }, scene);
    ridge.parent = body;
    ridge.position.set(0, wallH + 0.38, -buildingD * 0.3 + i * buildingD * 0.3);
    ridge.material = rustMat;
    exteriorCasters.push(ridge);
  }

  // ── HEADFRAME — tall wooden A-frame tower over the mine ─────────────
  const hfX = -6;
  const hfZ = 4; // behind the building
  const headRoot = new TransformNode(`hfRoot_${id}`, scene);
  headRoot.parent = body;
  headRoot.position.set(hfX, 0, hfZ);
  const hfH = 10;
  // 4 legs forming a pyramid
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const lx = Math.cos(ang) * 1.5;
    const lz = Math.sin(ang) * 1.5;
    const leg = MeshBuilder.CreateBox(`hfLeg_${id}_${i}`, {
      width: 0.3, height: hfH, depth: 0.3,
    }, scene);
    leg.parent = headRoot;
    leg.position.set(lx * 0.2, hfH / 2, lz * 0.2);
    leg.rotation.x = -Math.atan2(lz, hfH) * 0.35;
    leg.rotation.z = Math.atan2(lx, hfH) * 0.35;
    leg.material = darkWoodMat;
    leg.receiveShadows = true;
    exteriorCasters.push(leg);
  }
  // Cross beams (2 horizontals at top + middle)
  for (const y of [hfH * 0.5, hfH - 0.5]) {
    const cx = MeshBuilder.CreateBox(`hfCross_${id}_${y}`, { width: 2.0, height: 0.2, depth: 0.2 }, scene);
    cx.parent = headRoot;
    cx.position.y = y;
    cx.material = darkWoodMat;
    const cz = MeshBuilder.CreateBox(`hfCross_${id}_${y}_z`, { width: 0.2, height: 0.2, depth: 2.0 }, scene);
    cz.parent = headRoot;
    cz.position.y = y;
    cz.material = darkWoodMat;
  }
  // Hoist wheel at top (cylinder on its side)
  const wheel = MeshBuilder.CreateCylinder(`hfWheel_${id}`, {
    diameter: 2.2, height: 0.3, tessellation: 20,
  }, scene);
  wheel.parent = headRoot;
  wheel.rotation.z = Math.PI / 2;
  wheel.position.y = hfH - 0.2;
  wheel.material = metalMat;
  exteriorCasters.push(wheel);

  // Smokestack beside the headframe
  const stack = MeshBuilder.CreateCylinder(`mineStack_${id}`, {
    diameter: 1.2, height: 8, tessellation: 14,
  }, scene);
  stack.parent = body;
  stack.position.set(hfX + 3, wallH + 4, hfZ - 1);
  stack.material = metalMat;
  stack.receiveShadows = true;
  exteriorCasters.push(stack);

  // ── RAIL TRACKS extending out from the entrance ─────────────────────
  const railLen = 10;
  for (const rSide of [-0.6, 0.6]) {
    const rail = MeshBuilder.CreateBox(`rail_${id}_${rSide}`, {
      width: 0.15, height: 0.1, depth: railLen,
    }, scene);
    rail.parent = root;
    rail.position.set(rSide, 0.1, -lotHalfD + railLen / 2 + 1);
    rail.material = metalMat;
  }
  // 6 cross ties
  for (let i = 0; i < 6; i++) {
    const tie = MeshBuilder.CreateBox(`tie_${id}_${i}`, {
      width: 1.8, height: 0.08, depth: 0.4,
    }, scene);
    tie.parent = root;
    tie.position.set(0, 0.09, -lotHalfD + 1 + i * 1.8);
    tie.material = darkWoodMat;
  }

  // ── 2 ORE CARTS on the rails ────────────────────────────────────────
  for (let i = 0; i < 2; i++) {
    const cz = -lotHalfD + 3 + i * 5;
    const cart = MeshBuilder.CreateBox(`oreCart_${id}_${i}`, {
      width: 1.5, height: 1.1, depth: 1.6,
    }, scene);
    cart.parent = root;
    cart.position.set(0, 0.7, cz);
    cart.material = rustMat;
    cart.receiveShadows = true;
    exteriorCasters.push(cart);
    // 4 wheels
    for (const wx of [-0.7, 0.7]) {
      for (const wz_ of [-0.6, 0.6]) {
        const w = MeshBuilder.CreateCylinder(`cartW_${id}_${i}_${wx}_${wz_}`, {
          diameter: 0.5, height: 0.15, tessellation: 12,
        }, scene);
        w.parent = root;
        w.rotation.z = Math.PI / 2;
        w.position.set(wx, 0.25, cz + wz_);
        w.material = metalMat;
      }
    }
    // Ore pile in the cart
    const pile = MeshBuilder.CreateSphere(`cartOre_${id}_${i}`, {
      diameter: 1.2, segments: 10,
    }, scene);
    pile.parent = root;
    pile.position.set(0, 1.35, cz);
    pile.scaling.y = 0.35;
    pile.material = i === 1 ? oreGlow : oreMat;
  }

  // ── SLAG PILES around the lot ───────────────────────────────────────
  for (const [px, pz, size] of [
    [lotHalfW - 4, -lotHalfD + 3, 2.4],
    [lotHalfW - 5, lotHalfD - 4, 1.8],
    [-lotHalfW + 4, lotHalfD - 3, 2.0],
  ] as const) {
    const pile = MeshBuilder.CreateSphere(`slag_${id}_${px}`, {
      diameter: size, segments: 10,
    }, scene);
    pile.parent = root;
    pile.position.set(px, size * 0.3, pz);
    pile.scaling.y = 0.55;
    pile.material = oreMat;
    pile.receiveShadows = true;
    exteriorCasters.push(pile);
  }

  // ── PICKAXE leaning on the front-right wall ─────────────────────────
  const pickHandle = MeshBuilder.CreateCylinder(`pickH_${id}`, {
    diameter: 0.1, height: 1.6, tessellation: 8,
  }, scene);
  pickHandle.parent = body;
  pickHandle.rotation.z = 0.25;
  pickHandle.position.set(buildingW / 2 - 0.4, 0.8, -buildingD / 2 - 0.4);
  pickHandle.material = darkWoodMat;
  const pickHead = MeshBuilder.CreateBox(`pickHead_${id}`, {
    width: 0.6, height: 0.15, depth: 0.12,
  }, scene);
  pickHead.parent = body;
  pickHead.position.set(buildingW / 2 - 0.1, 1.55, -buildingD / 2 - 0.4);
  pickHead.material = metalMat;

  // ── LANTERN POST near the entrance ──────────────────────────────────
  const lanPost = MeshBuilder.CreateCylinder(`lanPost_${id}`, {
    diameter: 0.12, height: 3.0, tessellation: 8,
  }, scene);
  lanPost.parent = body;
  lanPost.position.set(-buildingW / 2 - 1.2, 1.5, -buildingD / 2 - 0.5);
  lanPost.material = trimMat;
  const lantern = MeshBuilder.CreateSphere(`lantern_${id}`, {
    diameter: 0.5, segments: 10,
  }, scene);
  lantern.parent = body;
  lantern.position.set(-buildingW / 2 - 1.2, 3.1, -buildingD / 2 - 0.5);
  lantern.material = lanternMat;

  // ── DIRT PATCH ground in front (darker color) — only covers the
  //    front yard so it doesn't z-fight with the interior floor.
  const dirt = MeshBuilder.CreateBox(`dirtPatch_${id}`, {
    width: lotW * 0.7, height: 0.05, depth: lotD * 0.35,
  }, scene);
  dirt.parent = root;
  dirt.position.set(0, 0.025, -lotD * 0.28);
  dirt.material = dirtMat;
  dirt.receiveShadows = true;

  // Furniture
  const furn = buildFurniture(scene, id, 'mine', Math.min(buildingW, buildingD) - spec.wallThickness * 2, wallH);
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
    centerXZ: [position.x, position.z],
    halfExtentsXZ: [buildingW / 2, buildingD / 2],
    interiorHeight: wallH,
  };
}
