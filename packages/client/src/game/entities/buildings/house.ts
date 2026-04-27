import {
  Scene,
  MeshBuilder,
  Vector3,
  Color3,
  TransformNode,
  AbstractMesh,
} from '@babylonjs/core';
import { buildFurniture } from '../buildingFurniture';
import {
  BuildingSpec,
  BuildingOutput,
  buildInteriorShell,
  buildFenceRun,
  buildMailbox,
  mat, isRoofMesh } from './shared';
import { buildGableRoof, buildTree, finishRoof } from './roofPrimitives';

/**
 * HOUSE composition:
 * - Cottage (22×20) with steep gable roof, cream walls + terracotta roof
 * - Front porch with 2 columns + shallow gable canopy + porch light
 * - Chimney on rear-left, rising above roof ridge
 * - Picket fence around front yard (3 sides, gap at entrance path)
 * - Stone path from sidewalk to front porch
 * - 2 trees flanking the front yard
 * - Flower bed under the front window
 * - Mailbox at the sidewalk
 */
export function buildHouse(
  scene: Scene,
  id: string | number,
  position: Vector3,
  spec: BuildingSpec,
): BuildingOutput {
  const root = new TransformNode(`house_${id}`, scene);
  root.position.copyFrom(position);

  const lotW = 34;
  const lotD = 32;
  const lotHalfW = lotW / 2;
  const lotHalfD = lotD / 2;

  const cottageW = 22;
  const cottageD = 20;
  const cottageOffsetZ = 2; // push cottage slightly back
  const wallH = spec.wallHeight;
  const peak = spec.roofPeak;

  const exteriorCasters: AbstractMesh[] = [];
  const collisionWalls: AbstractMesh[] = [];

  // Materials
  const wallMat = mat(scene, 'cottage-wall', '#F0E4C8', 0.9);
  const trimMat = mat(scene, 'cottage-trim', '#8B5A3C', 0.6);
  // Role name contains 'roof' so the shared mat() helper disables backface
  // culling (roof primitives are vertex-data slopes that get viewed from
  // both sides; with culling on, the back panel disappears at low angles).
  const roofMat = mat(scene, 'roof-terracotta', '#B04A2A', 0.75);
  const brickMat = mat(scene, 'brick', '#8A4A38', 0.88);
  const woodMat = mat(scene, 'wood-trim', '#C49A6C', 0.7);
  const pathMat = mat(scene, 'stone-path', '#B5AE9A', 0.9);
  const grassMat = mat(scene, 'flowerbed-soil', '#4A3020', 0.95);
  const flowerPink = mat(scene, 'flower-pink', '#E87A9B', 0.8, { emissive: new Color3(0.08, 0.03, 0.05) });
  const flowerYellow = mat(scene, 'flower-yellow', '#F0C84A', 0.75, { emissive: new Color3(0.08, 0.06, 0.02) });
  const leafMat = mat(scene, 'leaves', '#3E6B3A', 0.95);
  const trunkMat = mat(scene, 'trunk', '#5A3A22', 0.9);
  const lightMat = mat(scene, 'porchlight', '#FFE8B0', 0.2, { emissive: new Color3(0.8, 0.65, 0.3) });

  const cottageRoot = new TransformNode(`cottageRoot_${id}`, scene);
  cottageRoot.parent = root;
  cottageRoot.position.set(0, 0, cottageOffsetZ);

  // ── COTTAGE SHELL ───────────────────────────────────────────────────
  const shell = buildInteriorShell(
    scene, id, cottageRoot, spec,
    cottageW, cottageD,
    exteriorCasters, collisionWalls,
    wallMat, trimMat,
  );

  // ── GABLE ROOF (steep — characteristic cottage silhouette) ──────────
  const roof = buildGableRoof(scene, id, cottageW, cottageD, peak, 0.7);
  roof.parent = cottageRoot;
  roof.position.y = wallH;
  finishRoof(roof, roofMat, exteriorCasters);

  // ── CHIMNEY rear-left, rising above ridge ───────────────────────────
  const chimneyX = -cottageW * 0.3;
  const chimneyZ = cottageD * 0.25;
  const chimneyTopY = wallH + peak + 1.2;
  const chimney = MeshBuilder.CreateBox(`chimney_${id}`, {
    width: 1.2, height: chimneyTopY, depth: 1.2,
  }, scene);
  chimney.parent = cottageRoot;
  chimney.position.set(chimneyX, chimneyTopY / 2, chimneyZ);
  chimney.material = brickMat;
  chimney.receiveShadows = true;
  exteriorCasters.push(chimney);
  // Chimney cap
  const chimneyCap = MeshBuilder.CreateBox(`chimneyCap_${id}`, {
    width: 1.4, height: 0.2, depth: 1.4,
  }, scene);
  chimneyCap.parent = cottageRoot;
  chimneyCap.position.set(chimneyX, chimneyTopY + 0.1, chimneyZ);
  chimneyCap.material = trimMat;
  exteriorCasters.push(chimneyCap);

  // ── PORCH with 2 columns + gable canopy + porch light ───────────────
  const porchDepth = 2.0;
  const porchW = spec.doorWidth + 3.0;
  const porchDeckY = 0.25;
  const porchDeck = MeshBuilder.CreateBox(`porchDeck_${id}`, {
    width: porchW, height: 0.3, depth: porchDepth,
  }, scene);
  porchDeck.parent = cottageRoot;
  porchDeck.position.set(0, porchDeckY / 2 + 0.15, -cottageD / 2 - porchDepth / 2);
  porchDeck.material = woodMat;
  porchDeck.receiveShadows = true;
  exteriorCasters.push(porchDeck);

  // 2 columns flanking the door
  for (const cx of [-porchW / 2 + 0.45, porchW / 2 - 0.45]) {
    const col = MeshBuilder.CreateCylinder(`porchCol_${id}_${cx}`, {
      diameter: 0.35, height: spec.doorHeight + 0.3, tessellation: 14,
    }, scene);
    col.parent = cottageRoot;
    col.position.set(cx, (spec.doorHeight + 0.3) / 2 + 0.3, -cottageD / 2 - porchDepth + 0.35);
    col.material = trimMat;
    col.receiveShadows = true;
    exteriorCasters.push(col);
  }

  // Porch gable canopy — short gable over the porch.
  // Default orientation (no rotation) puts the ridge along X (left↔right
  // across the front of the house), so the front slope faces +Z (toward
  // the street) and the back slope faces -Z (against the house wall).
  // That's the conventional way porch awnings sit.
  const porchCanopy = buildGableRoof(scene, `porch_${id}`, porchW + 0.4, porchDepth + 0.6, 1.0, 0.2);
  porchCanopy.parent = cottageRoot;
  porchCanopy.position.set(0, spec.doorHeight + 0.6, -cottageD / 2 - porchDepth / 2 + 0.15);
  finishRoof(porchCanopy, roofMat, exteriorCasters);

  // Porch light — small emissive sphere + post
  const lightPost = MeshBuilder.CreateCylinder(`porchLightPost_${id}`, {
    diameter: 0.08, height: 0.6, tessellation: 8,
  }, scene);
  lightPost.parent = cottageRoot;
  lightPost.position.set(spec.doorWidth / 2 + 0.3, spec.doorHeight + 0.1, -cottageD / 2 + 0.15);
  lightPost.material = trimMat;
  const lightBulb = MeshBuilder.CreateSphere(`porchLight_${id}`, {
    diameter: 0.3, segments: 10,
  }, scene);
  lightBulb.parent = cottageRoot;
  lightBulb.position.set(spec.doorWidth / 2 + 0.3, spec.doorHeight + 0.5, -cottageD / 2 + 0.15);
  lightBulb.material = lightMat;

  // ── WINDOWS on front facade flanking the porch ──────────────────────
  // Was a solid brown box (winFrame) covering the glass; user reported the
  // windows reading as opaque "brown panes." Replaced with a glass plate
  // proud of the wall + a 4-piece trim border (sill, lintel, jambs) plus
  // the cross-muntin so the window reads as actual glass with a wooden
  // surround.
  const frontWinY = wallH * 0.55;
  const glassMat = mat(scene, 'window-glass', '#9AC8E8', 0.2, { alpha: 0.55, emissive: new Color3(0.3, 0.4, 0.5) });
  const winW = 1.5, winH = 1.4, frameT = 0.1;
  for (const side of [-1, 1]) {
    const winX = side * (cottageW / 2 - 2.2);
    const winZ = -cottageD / 2 - 0.04; // slightly proud of the front wall
    const glass = MeshBuilder.CreateBox(`winGlass_${id}_${side}`, {
      width: winW, height: winH, depth: 0.06,
    }, scene);
    glass.parent = cottageRoot;
    glass.position.set(winX, frontWinY, winZ);
    glass.material = glassMat;
    // 4-piece trim border (top/bottom/left/right) sitting just outside the glass
    const borderD = 0.08;
    const top = MeshBuilder.CreateBox(`winTop_${id}_${side}`, { width: winW + frameT * 2, height: frameT, depth: borderD }, scene);
    top.parent = cottageRoot; top.position.set(winX, frontWinY + winH / 2 + frameT / 2, winZ); top.material = trimMat;
    const bot = MeshBuilder.CreateBox(`winBot_${id}_${side}`, { width: winW + frameT * 2, height: frameT, depth: borderD }, scene);
    bot.parent = cottageRoot; bot.position.set(winX, frontWinY - winH / 2 - frameT / 2, winZ); bot.material = trimMat;
    const ljamb = MeshBuilder.CreateBox(`winL_${id}_${side}`, { width: frameT, height: winH, depth: borderD }, scene);
    ljamb.parent = cottageRoot; ljamb.position.set(winX - winW / 2 - frameT / 2, frontWinY, winZ); ljamb.material = trimMat;
    const rjamb = MeshBuilder.CreateBox(`winR_${id}_${side}`, { width: frameT, height: winH, depth: borderD }, scene);
    rjamb.parent = cottageRoot; rjamb.position.set(winX + winW / 2 + frameT / 2, frontWinY, winZ); rjamb.material = trimMat;
    // Cross-muntin (decorative wood cross) on the glass
    const muntinH = MeshBuilder.CreateBox(`mh_${id}_${side}`, { width: winW * 0.9, height: 0.05, depth: 0.05 }, scene);
    muntinH.parent = cottageRoot; muntinH.position.set(winX, frontWinY, winZ - 0.04); muntinH.material = trimMat;
    const muntinV = MeshBuilder.CreateBox(`mv_${id}_${side}`, { width: 0.05, height: winH * 0.9, depth: 0.05 }, scene);
    muntinV.parent = cottageRoot; muntinV.position.set(winX, frontWinY, winZ - 0.04); muntinV.material = trimMat;
  }

  // ── FLOWER BED under the front window (left side) ───────────────────
  const bedX = -cottageW / 2 + 2.2;
  const bedZ = -cottageD / 2 - 0.9;
  const bedBase = MeshBuilder.CreateBox(`flowerBed_${id}`, {
    width: 2.4, height: 0.3, depth: 0.9,
  }, scene);
  bedBase.parent = cottageRoot;
  bedBase.position.set(bedX, 0.18, bedZ);
  bedBase.material = grassMat;
  bedBase.receiveShadows = true;
  // Flowers — 6 small spheres alternating pink/yellow
  for (let i = 0; i < 6; i++) {
    const fx = bedX - 1 + i * 0.4;
    const flower = MeshBuilder.CreateSphere(`flower_${id}_${i}`, {
      diameter: 0.3, segments: 8,
    }, scene);
    flower.parent = cottageRoot;
    flower.position.set(fx, 0.45, bedZ);
    flower.material = i % 2 === 0 ? flowerPink : flowerYellow;
  }

  // ── STONE PATH from sidewalk to porch ───────────────────────────────
  // Path goes from front of lot (z=-lotHalfD) to porch (z=-cottageD/2-porchDepth+cottageOffsetZ)
  const pathStartZ = -lotHalfD + 0.5;
  const pathEndZ = cottageOffsetZ - cottageD / 2 - porchDepth;
  const pathLen = pathStartZ - pathEndZ;
  const path = MeshBuilder.CreateBox(`path_${id}`, {
    width: 1.8, height: 0.12, depth: pathLen,
  }, scene);
  path.parent = root;
  path.position.set(0, 0.12, (pathStartZ + pathEndZ) / 2);
  path.material = pathMat;
  path.receiveShadows = true;

  // ── 2 TREES flanking the front yard ─────────────────────────────────
  const tree1 = buildTree(scene, `${id}_1`, trunkMat, leafMat, 4.5);
  tree1.parent = root;
  tree1.position.set(-lotHalfW + 3, 0, -lotHalfD + 5);
  const tree2 = buildTree(scene, `${id}_2`, trunkMat, leafMat, 4.0);
  tree2.parent = root;
  tree2.position.set(lotHalfW - 3, 0, -lotHalfD + 5);

  // ── PICKET FENCE around front yard (3 sides, gap for path) ──────────
  const fenceH = 1.0;
  // Front-left (from lot corner to path edge)
  buildFenceRun(scene, `${id}_ff_l`, root, -lotHalfW, -lotHalfD, -1.2, -lotHalfD, fenceH, woodMat);
  // Front-right
  buildFenceRun(scene, `${id}_ff_r`, root, 1.2, -lotHalfD, lotHalfW, -lotHalfD, fenceH, woodMat);
  // Left side (front half only, from front to middle of lot)
  buildFenceRun(scene, `${id}_fs_l`, root, -lotHalfW, -lotHalfD, -lotHalfW, 0, fenceH, woodMat);
  // Right side
  buildFenceRun(scene, `${id}_fs_r`, root, lotHalfW, -lotHalfD, lotHalfW, 0, fenceH, woodMat);

  // ── MAILBOX at the sidewalk next to the path ────────────────────────
  buildMailbox(scene, `${id}`, root, 2.6, -lotHalfD - 0.5, trimMat);

  // Furniture interior
  const furn = buildFurniture(scene, id, 'house', Math.min(cottageW, cottageD) - spec.wallThickness * 2, wallH);
  furn.root.parent = cottageRoot;

  // Roof meshes = ceiling + everything above ~3u
  const roofMeshes: AbstractMesh[] = [shell.ceiling];
  for (const m of exteriorCasters.slice(shell.wallsAdded)) {
    const y = m.getAbsolutePosition().y;
    if (isRoofMesh(m.name) || y > 2.5) roofMeshes.push(m);
  }

  return {
    root,
    exteriorCasters,
    collisionWalls,
    roofMeshes,
    centerXZ: [position.x, position.z + cottageOffsetZ],
    halfExtentsXZ: [cottageW / 2, cottageD / 2],
    interiorHeight: wallH,
  };
}
