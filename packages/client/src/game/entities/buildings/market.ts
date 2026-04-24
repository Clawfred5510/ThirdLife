import {
  Scene,
  MeshBuilder,
  Vector3,
  Color3,
  TransformNode,
  AbstractMesh,
} from '@babylonjs/core';
import { BuildingSpec, BuildingOutput, mat } from './shared';

/**
 * MARKET — open-air farmers market (no building shell):
 * - Central stone fountain (base + water disc + plinth + sphere cap)
 * - Ring of 8 vendor stalls arranged around the fountain, each with its
 *   own striped awning + counter + produce crates
 * - Tall central flagpole with a pennant
 * - String of light-bulb spheres arcing between the stalls
 * - Cobblestone plaza ground
 *
 * No doorway + no interior — nothing fades when the player walks across
 * the plaza.
 */
export function buildMarket(
  scene: Scene,
  id: string | number,
  position: Vector3,
  spec: BuildingSpec,
): BuildingOutput {
  void spec;
  const root = new TransformNode(`market_${id}`, scene);
  root.position.copyFrom(position);

  const lotW = 36;
  const lotD = 32;

  const exteriorCasters: AbstractMesh[] = [];
  const collisionWalls: AbstractMesh[] = [];

  const cobbleMat = mat(scene, 'cobble', '#8E8272', 0.92);
  const stoneMat = mat(scene, 'mkStone', '#9C928A', 0.88);
  const woodMat = mat(scene, 'mkWood', '#8A5A30', 0.85);
  const whiteMat = mat(scene, 'mkStripeWhite', '#F0EAD8', 0.7);
  const trimMat = mat(scene, 'mkTrim', '#3A2A1F', 0.6);
  const waterMat = mat(scene, 'mkWater', '#62A8C0', 0.1, { metallic: 0.25, alpha: 0.75, emissive: new Color3(0.05, 0.1, 0.15) });
  const bulbMat = mat(scene, 'mkBulb', '#F4CE5A', 0.2, { emissive: new Color3(0.8, 0.55, 0.15) });
  const flagMat = mat(scene, 'mkPennant', '#D63A3A', 0.85);

  // Cobblestone plaza covering the lot
  const plaza = MeshBuilder.CreateBox(`mkPlaza_${id}`, {
    width: lotW - 1, height: 0.08, depth: lotD - 1,
  }, scene);
  plaza.parent = root;
  plaza.position.set(0, 0.04, 0);
  plaza.material = cobbleMat;
  plaza.receiveShadows = true;

  // Central fountain
  const fountBase = MeshBuilder.CreateCylinder(`mkFountBase_${id}`, {
    diameter: 5.0, height: 1.0, tessellation: 32,
  }, scene);
  fountBase.parent = root;
  fountBase.position.set(0, 0.5, 0);
  fountBase.material = stoneMat;
  fountBase.receiveShadows = true;
  exteriorCasters.push(fountBase);
  const rim = MeshBuilder.CreateCylinder(`mkFountRim_${id}`, {
    diameter: 5.1, height: 0.3, tessellation: 32,
  }, scene);
  rim.parent = root;
  rim.position.set(0, 1.05, 0);
  rim.material = stoneMat;
  exteriorCasters.push(rim);
  const water = MeshBuilder.CreateCylinder(`mkWater_${id}`, {
    diameter: 4.4, height: 0.12, tessellation: 32,
  }, scene);
  water.parent = root;
  water.position.set(0, 1.1, 0);
  water.material = waterMat;
  const plinth = MeshBuilder.CreateCylinder(`mkPlinth_${id}`, {
    diameter: 0.9, height: 2.0, tessellation: 16,
  }, scene);
  plinth.parent = root;
  plinth.position.set(0, 2.1, 0);
  plinth.material = stoneMat;
  exteriorCasters.push(plinth);
  const topSphere = MeshBuilder.CreateSphere(`mkFountTop_${id}`, {
    diameter: 1.0, segments: 14,
  }, scene);
  topSphere.parent = root;
  topSphere.position.set(0, 3.3, 0);
  topSphere.material = stoneMat;
  exteriorCasters.push(topSphere);

  // Tall central flagpole on top of the fountain
  const pole = MeshBuilder.CreateCylinder(`mkPole_${id}`, {
    diameter: 0.16, height: 5.5, tessellation: 10,
  }, scene);
  pole.parent = root;
  pole.position.set(0, 6.55, 0);
  pole.material = trimMat;
  exteriorCasters.push(pole);
  const pennant = MeshBuilder.CreateBox(`mkPennant_${id}`, {
    width: 1.4, height: 0.7, depth: 0.04,
  }, scene);
  pennant.parent = root;
  pennant.position.set(0.7, 8.6, 0);
  pennant.material = flagMat;
  exteriorCasters.push(pennant);

  // Ring of 8 vendor stalls around the fountain
  const stallColors = ['#D63A3A', '#5AAF5A', '#E8A030', '#3A7FBF', '#B060B0', '#E8BC30', '#5AA8A8', '#C858A0'];
  const stallRadius = 11;
  const nStalls = 8;
  for (let i = 0; i < nStalls; i++) {
    const ang = (i / nStalls) * Math.PI * 2;
    const sx = Math.sin(ang) * stallRadius;
    const sz = Math.cos(ang) * stallRadius;
    const stallRoot = new TransformNode(`stallRoot_${id}_${i}`, scene);
    stallRoot.parent = root;
    stallRoot.position.set(sx, 0, sz);
    stallRoot.rotation.y = ang + Math.PI;

    const counter = MeshBuilder.CreateBox(`stallCounter_${id}_${i}`, {
      width: 2.4, height: 0.95, depth: 1.0,
    }, scene);
    counter.parent = stallRoot;
    counter.position.y = 0.475;
    counter.material = woodMat;
    counter.receiveShadows = true;
    exteriorCasters.push(counter);

    for (let p = 0; p < 2; p++) {
      const crate = MeshBuilder.CreateBox(`crate_${id}_${i}_${p}`, {
        width: 0.8, height: 0.45, depth: 0.65,
      }, scene);
      crate.parent = stallRoot;
      crate.position.set(-0.6 + p * 1.2, 1.2, 0);
      crate.material = mat(scene, `mkProduce-${i}-${p}`, stallColors[(i + p) % stallColors.length], 0.8);
    }

    for (const px of [-1.1, 1.1]) {
      for (const pz of [-0.45, 0.45]) {
        const pl = MeshBuilder.CreateCylinder(`stallPole_${id}_${i}_${px}_${pz}`, {
          diameter: 0.09, height: 2.6, tessellation: 8,
        }, scene);
        pl.parent = stallRoot;
        pl.position.set(px, 1.3, pz);
        pl.material = trimMat;
      }
    }

    for (let s = 0; s < 5; s++) {
      const stripe = MeshBuilder.CreateBox(`stallStrip_${id}_${i}_${s}`, {
        width: 2.5, height: 0.12, depth: 1.2 / 5,
      }, scene);
      stripe.parent = stallRoot;
      stripe.position.set(0, 2.7, -0.5 + s * (1.2 / 5) + (1.2 / 10));
      stripe.material = s % 2 === 0
        ? mat(scene, `stallColor-${i}`, stallColors[i], 0.7)
        : whiteMat;
      stripe.receiveShadows = true;
    }
  }

  // Arcing light-bulb string between the stalls
  const nBulbs = 24;
  for (let i = 0; i < nBulbs; i++) {
    const ang = (i / nBulbs) * Math.PI * 2;
    const r = stallRadius - 1;
    const bx = Math.sin(ang) * r;
    const bz = Math.cos(ang) * r;
    const by = 3.8 + Math.sin(ang * 4) * 0.3;
    const bulb = MeshBuilder.CreateSphere(`mkBulb_${id}_${i}`, {
      diameter: 0.3, segments: 8,
    }, scene);
    bulb.parent = root;
    bulb.position.set(bx, by, bz);
    bulb.material = bulbMat;
  }

  return {
    root,
    exteriorCasters,
    collisionWalls,
    roofMeshes: [],
    centerXZ: [position.x, position.z],
    // Tiny half-extent so the "player is inside" check never fires on the
    // market. It's open-air — nothing should fade.
    halfExtentsXZ: [0.1, 0.1],
    interiorHeight: 0,
  };
}
