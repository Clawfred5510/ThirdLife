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
import { buildSawtoothRoof, finishRoof } from './roofPrimitives';

/**
 * FACTORY composition:
 * - Industrial rectangular hall (32×26) with sawtooth roof (3 bays)
 * - 2 tall smokestacks rising from the back-left
 * - Cylindrical water tower on the right
 * - Loading dock on the right side with stacked crates
 * - Pipe maze on the side wall
 * - Chain-link fence around the lot (simplified as posts)
 */
export function buildFactory(
  scene: Scene,
  id: string | number,
  position: Vector3,
  spec: BuildingSpec,
): BuildingOutput {
  const root = new TransformNode(`factory_${id}`, scene);
  root.position.copyFrom(position);

  const lotW = 36;
  const lotD = 32;
  const lotHalfW = lotW / 2;
  const lotHalfD = lotD / 2;

  const buildingW = 28;
  const buildingD = 22;
  const wallH = spec.wallHeight;

  const exteriorCasters: AbstractMesh[] = [];
  const collisionWalls: AbstractMesh[] = [];

  const wallMat = mat(scene, 'fac-wall', '#7A7A80', 0.88);
  const trimMat = mat(scene, 'fac-trim', '#2A2A2E', 0.6);
  const roofMat = mat(scene, 'fac-roof', '#4A4E58', 0.72);
  const metalMat = mat(scene, 'fac-metal', '#8A8A8E', 0.5, { metallic: 0.5 });
  const rustMat = mat(scene, 'rust', '#8A5A3A', 0.75, { metallic: 0.3 });
  const concreteMat = mat(scene, 'concrete', '#A0A0A0', 0.9);
  const crateMat = mat(scene, 'crate-wood', '#9A6A3A', 0.85);
  const glassBand = mat(scene, 'fac-glass', '#A8C8D8', 0.2, { alpha: 0.5, emissive: new Color3(0.2, 0.3, 0.4) });

  const body = new TransformNode(`facBody_${id}`, scene);
  body.parent = root;

  const shell = buildInteriorShell(
    scene, id, body, spec,
    buildingW, buildingD,
    exteriorCasters, collisionWalls,
    wallMat, trimMat,
  );

  // ── SAWTOOTH ROOF (3 bays) ──────────────────────────────────────────
  const saw = buildSawtoothRoof(scene, id, buildingW, buildingD, spec.roofPeak, 3, 0.4);
  saw.parent = body;
  saw.position.y = wallH;
  finishRoof(saw, roofMat, exteriorCasters);

  // Glass bands on the vertical (north-facing) face of each sawtooth bay
  const bayD = buildingD / 3;
  for (let i = 0; i < 3; i++) {
    const bz = -buildingD / 2 + bayD * (i + 1) - 0.05;
    const band = MeshBuilder.CreateBox(`facGlass_${id}_${i}`, {
      width: buildingW * 0.95, height: spec.roofPeak * 0.85, depth: 0.25,
    }, scene);
    band.parent = body;
    band.position.set(0, wallH + spec.roofPeak * 0.5, bz);
    band.material = glassBand;
    exteriorCasters.push(band);
  }

  // ── 2 TALL SMOKESTACKS on back-left ─────────────────────────────────
  for (let i = 0; i < 2; i++) {
    const sx = -buildingW * 0.3 + i * 2.2;
    const stack = MeshBuilder.CreateCylinder(`stack_${id}_${i}`, {
      diameter: 1.4, height: 9, tessellation: 16,
    }, scene);
    stack.parent = body;
    stack.position.set(sx, wallH + spec.roofPeak + 4, buildingD * 0.35);
    stack.material = trimMat;
    stack.receiveShadows = true;
    exteriorCasters.push(stack);
    const cap = MeshBuilder.CreateCylinder(`stackCap_${id}_${i}`, {
      diameter: 1.7, height: 0.35, tessellation: 16,
    }, scene);
    cap.parent = body;
    cap.position.set(sx, wallH + spec.roofPeak + 8.6, buildingD * 0.35);
    cap.material = rustMat;
    exteriorCasters.push(cap);
    // White steam puff
    const puff = MeshBuilder.CreateSphere(`steam_${id}_${i}`, { diameter: 2.2, segments: 10 }, scene);
    puff.parent = body;
    puff.position.set(sx + 0.2, wallH + spec.roofPeak + 10.5, buildingD * 0.35 + 0.3);
    puff.material = mat(scene, 'steam', '#F8F6F4', 0.95, { alpha: 0.75 });
    exteriorCasters.push(puff);
  }

  // ── WATER TOWER on right side of roof ────────────────────────────────
  const wtX = buildingW * 0.28;
  const wtLegY = wallH + spec.roofPeak;
  // Lattice legs (4 thin cylinders forming an X frame).
  // exteriorCasters.push so legs enter the roof-fade list and disappear
  // along with the rest of the rooftop kit when the player walks inside.
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const lx = wtX + Math.cos(ang) * 0.9;
    const lz = buildingD * 0.1 + Math.sin(ang) * 0.9;
    const leg = MeshBuilder.CreateBox(`wtLeg_${id}_${i}`, { width: 0.12, height: 3, depth: 0.12 }, scene);
    leg.parent = body;
    leg.position.set(lx, wtLegY + 1.5, lz);
    leg.material = metalMat;
    exteriorCasters.push(leg);
  }
  const drum = MeshBuilder.CreateCylinder(`wtDrum_${id}`, {
    diameter: 2.6, height: 3.0, tessellation: 16,
  }, scene);
  drum.parent = body;
  drum.position.set(wtX, wtLegY + 4.5, buildingD * 0.1);
  drum.material = rustMat;
  drum.receiveShadows = true;
  exteriorCasters.push(drum);
  const drumTop = MeshBuilder.CreateCylinder(`wtDrumTop_${id}`, {
    diameter: 2.6, height: 0.6, tessellation: 16,
  }, scene);
  drumTop.parent = body;
  drumTop.position.set(wtX, wtLegY + 6.3, buildingD * 0.1);
  drumTop.material = trimMat;
  exteriorCasters.push(drumTop);

  // ── LOADING DOCK on right side of building ──────────────────────────
  const dockW = 2.5;
  const dockD = buildingD * 0.55;
  const dock = MeshBuilder.CreateBox(`dock_${id}`, {
    width: dockW, height: 1.2, depth: dockD,
  }, scene);
  dock.parent = body;
  dock.position.set(buildingW / 2 + dockW / 2 + 0.1, 0.6, 0);
  dock.material = concreteMat;
  dock.receiveShadows = true;
  exteriorCasters.push(dock);
  // 3 stacked crates on the dock
  for (let i = 0; i < 3; i++) {
    const cz = -dockD * 0.3 + i * 1.0;
    const crate = MeshBuilder.CreateBox(`dockCrate_${id}_${i}`, {
      width: 1.0, height: 0.8, depth: 0.9,
    }, scene);
    crate.parent = body;
    crate.position.set(buildingW / 2 + dockW / 2 + 0.1, 1.6, cz);
    crate.material = crateMat;
    crate.receiveShadows = true;
    exteriorCasters.push(crate);
  }

  // ── PIPE MAZE on the left-outer wall ─────────────────────────────────
  const pipeX = -buildingW / 2 - 0.25;
  // 2 vertical pipes + 1 horizontal connector
  const pipe1 = MeshBuilder.CreateCylinder(`pipe_${id}_1`, {
    diameter: 0.4, height: wallH + 1.5, tessellation: 10,
  }, scene);
  pipe1.parent = body;
  pipe1.position.set(pipeX, (wallH + 1.5) / 2, -buildingD * 0.3);
  pipe1.material = rustMat;
  exteriorCasters.push(pipe1);
  const pipe2 = MeshBuilder.CreateCylinder(`pipe_${id}_2`, {
    diameter: 0.4, height: wallH + 1.5, tessellation: 10,
  }, scene);
  pipe2.parent = body;
  pipe2.position.set(pipeX, (wallH + 1.5) / 2, buildingD * 0.1);
  pipe2.material = rustMat;
  exteriorCasters.push(pipe2);
  const pipeH = MeshBuilder.CreateCylinder(`pipe_${id}_h`, {
    diameter: 0.4, height: buildingD * 0.4, tessellation: 10,
  }, scene);
  pipeH.parent = body;
  pipeH.rotation.x = Math.PI / 2;
  pipeH.position.set(pipeX, wallH - 1, -buildingD * 0.1);
  pipeH.material = rustMat;
  exteriorCasters.push(pipeH);

  // ── CHAIN-LINK FENCE (full perimeter) ───────────────────────────────
  // Was just posts on the front face. Now a real perimeter with posts
  // every 4u on all four sides + thin horizontal rails (top + bottom)
  // and a translucent grey "mesh" panel between adjacent posts so the
  // fence reads as chain-link rather than a row of poles. Each panel
  // has checkCollisions=true so the player can't walk through. Front
  // face has a 6u gap centred at x=0 for the entry path.
  const fenceH = 1.8;
  const fenceMeshMat = mat(scene, 'fac-fence-mesh', '#7E8088', 0.9, { alpha: 0.35 });
  const fencePostStep = 4;
  const buildPost = (x: number, z: number, key: string) => {
    const post = MeshBuilder.CreateBox(`fencePost_${id}_${key}`, {
      width: 0.18, height: fenceH, depth: 0.18,
    }, scene);
    post.parent = root;
    post.position.set(x, fenceH / 2, z);
    post.material = metalMat;
    post.receiveShadows = true;
  };
  const buildPanel = (x1: number, z1: number, x2: number, z2: number, key: string) => {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) return;
    const cx = (x1 + x2) / 2;
    const cz = (z1 + z2) / 2;
    const panel = MeshBuilder.CreateBox(`fencePanel_${id}_${key}`, {
      width: len, height: fenceH * 0.95, depth: 0.05,
    }, scene);
    panel.parent = root;
    panel.position.set(cx, fenceH / 2, cz);
    panel.rotation.y = -Math.atan2(dz, dx);
    panel.material = fenceMeshMat;
    panel.checkCollisions = true;
    collisionWalls.push(panel);
    // Top rail (thin metal bar)
    const top = MeshBuilder.CreateBox(`fenceRailT_${id}_${key}`, {
      width: len, height: 0.06, depth: 0.06,
    }, scene);
    top.parent = root;
    top.position.set(cx, fenceH - 0.1, cz);
    top.rotation.y = -Math.atan2(dz, dx);
    top.material = metalMat;
    // Bottom rail
    const bot = MeshBuilder.CreateBox(`fenceRailB_${id}_${key}`, {
      width: len, height: 0.06, depth: 0.06,
    }, scene);
    bot.parent = root;
    bot.position.set(cx, 0.1, cz);
    bot.rotation.y = -Math.atan2(dz, dx);
    bot.material = metalMat;
  };
  // Build posts + panels along each of the 4 perimeter edges.
  // Front edge has a 6u gap centered on x=0 (skip posts/panels in that range).
  const sides: Array<{ p1: [number, number]; p2: [number, number]; key: string; gap?: [number, number] }> = [
    { p1: [-lotHalfW, -lotHalfD], p2: [lotHalfW, -lotHalfD], key: 'front', gap: [-3, 3] },
    { p1: [-lotHalfW, lotHalfD],  p2: [lotHalfW, lotHalfD],  key: 'back' },
    { p1: [-lotHalfW, -lotHalfD], p2: [-lotHalfW, lotHalfD], key: 'left' },
    { p1: [lotHalfW, -lotHalfD],  p2: [lotHalfW, lotHalfD],  key: 'right' },
  ];
  for (const side of sides) {
    const dx = side.p2[0] - side.p1[0];
    const dz = side.p2[1] - side.p1[1];
    const len = Math.hypot(dx, dz);
    const segments = Math.max(1, Math.round(len / fencePostStep));
    let prev: [number, number] | null = null;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const px = side.p1[0] + dx * t;
      const pz = side.p1[1] + dz * t;
      const inGap = side.gap && px >= side.gap[0] && px <= side.gap[1] && Math.abs(dz) < 0.1;
      if (!inGap) buildPost(px, pz, `${side.key}_${i}`);
      if (prev) {
        const midX = (prev[0] + px) / 2;
        const prevInGap = side.gap && prev[0] >= side.gap[0] && prev[0] <= side.gap[1] && Math.abs(dz) < 0.1;
        const segInGap = side.gap && midX >= side.gap[0] && midX <= side.gap[1] && Math.abs(dz) < 0.1;
        if (!segInGap && !inGap && !prevInGap) {
          buildPanel(prev[0], prev[1], px, pz, `${side.key}_${i}`);
        }
      }
      prev = [px, pz];
    }
  }

  // Furniture
  const furn = buildFurniture(scene, id, 'factory', Math.min(buildingW, buildingD) - spec.wallThickness * 2, wallH);
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
