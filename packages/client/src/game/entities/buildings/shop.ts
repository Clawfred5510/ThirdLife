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
 * SHOP composition:
 * - Main-street storefront (28×18) with flat roof + tall blade sign above
 * - Full-height glass display windows flanking the door
 * - Striped fabric awning spanning the width above the windows
 * - Sandwich-board A-frame sign on the sidewalk
 * - Outdoor merchandise rack beside the entrance
 * - Bench + newspaper box near the sidewalk
 */
export function buildShop(
  scene: Scene,
  id: string | number,
  position: Vector3,
  spec: BuildingSpec,
): BuildingOutput {
  const root = new TransformNode(`shop_${id}`, scene);
  root.position.copyFrom(position);

  const lotW = 36;
  const lotD = 32;
  const lotHalfD = lotD / 2;

  const shopW = 28;
  const shopD = 16;
  const wallH = spec.wallHeight;

  const exteriorCasters: AbstractMesh[] = [];
  const collisionWalls: AbstractMesh[] = [];

  const wallMat = mat(scene, 'shop-wall', '#F0C850', 0.85);
  const trimMat = mat(scene, 'shop-trim', '#3A1F14', 0.6);
  const roofMat = mat(scene, 'shop-roof', '#B04830', 0.7);
  const glassMat = mat(scene, 'shop-glass', '#BADCE8', 0.15, { alpha: 0.5, emissive: new Color3(0.35, 0.45, 0.55) });
  const woodMat = mat(scene, 'shop-wood', '#7A4A30', 0.85);
  const signWhite = mat(scene, 'sign-white', '#F5EFE0', 0.55, { emissive: new Color3(0.18, 0.16, 0.12) });
  const signRed = mat(scene, 'sign-red', '#D63030', 0.5);
  const paperMat = mat(scene, 'news-paper', '#E0D6C0', 0.9);

  const body = new TransformNode(`shopBody_${id}`, scene);
  body.parent = root;

  const shell = buildInteriorShell(
    scene, id, body, spec,
    shopW, shopD,
    exteriorCasters, collisionWalls,
    wallMat, trimMat,
  );

  // ── FLAT ROOF ──────────────────────────────────────────────────────
  const flat = MeshBuilder.CreateBox(`shopRoof_${id}`, {
    width: shopW + 0.3, height: 0.3, depth: shopD + 0.3,
  }, scene);
  flat.parent = body;
  flat.position.y = wallH + 0.15;
  flat.material = trimMat;
  flat.receiveShadows = true;
  exteriorCasters.push(flat);

  // ── TALL BLADE SIGN above the roofline ──────────────────────────────
  const sign = MeshBuilder.CreateBox(`shopSign_${id}`, {
    width: shopW * 0.7, height: 2.6, depth: 0.35,
  }, scene);
  sign.parent = body;
  sign.position.set(0, wallH + 1.7, -shopD / 2 - 0.2);
  sign.material = signRed;
  sign.receiveShadows = true;
  exteriorCasters.push(sign);
  // Illuminated text panel
  const signText = MeshBuilder.CreateBox(`shopSignTxt_${id}`, {
    width: shopW * 0.6, height: 1.6, depth: 0.1,
  }, scene);
  signText.parent = body;
  signText.position.set(0, wallH + 1.7, -shopD / 2 - 0.4);
  signText.material = signWhite;

  // ── STRIPED AWNING above the storefront windows ─────────────────────
  const awningD = 2.0;
  for (let i = 0; i < 4; i++) {
    const stripe = MeshBuilder.CreateBox(`shopAwning_${id}_${i}`, {
      width: shopW * 0.85, height: 0.18, depth: awningD / 4,
    }, scene);
    stripe.parent = body;
    stripe.position.set(0, spec.doorHeight + 0.8, -shopD / 2 - awningD / 2 + i * (awningD / 4) + (awningD / 8));
    stripe.material = i % 2 === 0 ? signRed : signWhite;
    stripe.receiveShadows = true;
    exteriorCasters.push(stripe);
  }

  // ── FULL-HEIGHT DISPLAY WINDOWS flanking the door ────────────────────
  const winH = spec.doorHeight - 0.3;
  const winY = winH / 2 + 0.4;
  const winW = (shopW - spec.doorWidth - 2) / 2 - 0.6;
  for (const side of [-1, 1]) {
    const xCenter = side * (spec.doorWidth / 2 + 0.6 + winW / 2);
    const frame = MeshBuilder.CreateBox(`shopWinF_${id}_${side}`, {
      width: winW + 0.25, height: winH + 0.25, depth: spec.wallThickness * 1.1,
    }, scene);
    frame.parent = body;
    frame.position.set(xCenter, winY, -shopD / 2 + spec.wallThickness / 2);
    frame.material = trimMat;
    const glass = MeshBuilder.CreateBox(`shopWin_${id}_${side}`, {
      width: winW, height: winH, depth: spec.wallThickness * 0.6,
    }, scene);
    glass.parent = frame;
    glass.material = glassMat;
  }

  // ── SANDWICH-BOARD A-FRAME SIGN ─────────────────────────────────────
  const sandX = 3;
  const sandZ = -lotHalfD + 4;
  for (const side of [-1, 1]) {
    const plate = MeshBuilder.CreateBox(`sand_${id}_${side}`, {
      width: 1.2, height: 1.6, depth: 0.1,
    }, scene);
    plate.parent = root;
    plate.position.set(sandX, 0.8, sandZ);
    plate.rotation.z = 0;
    plate.rotation.x = side * -0.2;
    plate.position.z += side * 0.15;
    plate.material = signWhite;
    exteriorCasters.push(plate);
  }

  // ── OUTDOOR MERCHANDISE RACK ────────────────────────────────────────
  const rackX = -5;
  const rackZ = -lotHalfD + 5;
  const rackBase = MeshBuilder.CreateBox(`rack_${id}`, {
    width: 2.2, height: 1.4, depth: 0.9,
  }, scene);
  rackBase.parent = root;
  rackBase.position.set(rackX, 0.7, rackZ);
  rackBase.material = woodMat;
  rackBase.receiveShadows = true;
  exteriorCasters.push(rackBase);
  // Colored items on rack
  const itemColors = ['#5A9A3A', '#3A5AE8', '#E8A030', '#B040B0'];
  for (let i = 0; i < 4; i++) {
    const item = MeshBuilder.CreateBox(`rackItem_${id}_${i}`, {
      width: 0.45, height: 0.35, depth: 0.5,
    }, scene);
    item.parent = root;
    item.position.set(rackX - 0.8 + i * 0.55, 1.55, rackZ);
    item.material = mat(scene, `rack-${i}`, itemColors[i], 0.8);
  }

  // ── BENCH near the sidewalk ─────────────────────────────────────────
  const benchX = 8;
  const benchZ = -lotHalfD + 3.5;
  const benchSeat = MeshBuilder.CreateBox(`bench_${id}_seat`, {
    width: 2.2, height: 0.12, depth: 0.6,
  }, scene);
  benchSeat.parent = root;
  benchSeat.position.set(benchX, 0.5, benchZ);
  benchSeat.material = woodMat;
  exteriorCasters.push(benchSeat);
  // Bench legs
  for (const lx of [-0.9, 0.9]) {
    const leg = MeshBuilder.CreateBox(`bench_${id}_leg_${lx}`, {
      width: 0.15, height: 0.5, depth: 0.5,
    }, scene);
    leg.parent = root;
    leg.position.set(benchX + lx, 0.25, benchZ);
    leg.material = trimMat;
  }

  // ── NEWSPAPER BOX ────────────────────────────────────────────────────
  const newsX = 11;
  const newsBox = MeshBuilder.CreateBox(`news_${id}`, {
    width: 0.7, height: 1.3, depth: 0.45,
  }, scene);
  newsBox.parent = root;
  newsBox.position.set(newsX, 0.65, benchZ);
  newsBox.material = paperMat;
  exteriorCasters.push(newsBox);

  // Furniture
  const furn = buildFurniture(scene, id, 'shop', Math.min(shopW, shopD) - spec.wallThickness * 2, wallH);
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
    halfExtentsXZ: [shopW / 2, shopD / 2],
  };
}
