import {
  Scene,
  MeshBuilder,
  Vector3,
  Color3,
  TransformNode,
  AbstractMesh,
} from '@babylonjs/core';
import { AdvancedDynamicTexture, TextBlock } from '@babylonjs/gui';
import { buildFurniture } from '../buildingFurniture';
import { BuildingSpec, BuildingOutput, buildInteriorShell, mat, isRoofMesh } from './shared';

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
  businessName?: string,
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
  // White text panel. Babylon's CreateBox lays out the front (+Z) face's
  // UV such that the texture appears mirrored when viewed from the south
  // (-Z). The fix is on the texture, not the geometry: setting uScale=-1
  // on the ADT flips the texture's U sampling, and combined with the
  // face's mirror those two flips cancel and the player sees correct
  // text. Rotating the box doesn't help because both opposing faces have
  // the same UV layout, so they look identical regardless of orientation.
  const signText = MeshBuilder.CreateBox(`shopSignTxt_${id}`, {
    width: shopW * 0.6, height: 1.6, depth: 0.1,
  }, scene);
  signText.parent = body;
  signText.position.set(0, wallH + 1.7, -shopD / 2 - 0.6);
  signText.material = signWhite;
  exteriorCasters.push(signText);

  if (businessName && businessName.trim().length > 0) {
    // CreateForMesh replaces the mesh's material with one whose diffuse
    // texture is this ADT. Without adt.background the panel renders
    // transparent outside the glyphs, which is what was making the white
    // panel invisible in earlier rounds. Cream matches the rocket sign.
    const adt = AdvancedDynamicTexture.CreateForMesh(signText, 1024, 256);
    adt.background = '#FFFAE8';
    // Cancel the box face's mirrored U sampling. uScale=-1 alone moves
    // the visible content outside [0,1]; uOffset=1 shifts it back in.
    // Together they map u → 1-u, i.e. a horizontal flip within the same
    // visible region.
    adt.uScale = -1;
    adt.uOffset = 1;
    const text = new TextBlock('shopName', businessName.trim().toUpperCase());
    text.color = '#1A1208';
    text.fontFamily = 'Arial';
    text.fontWeight = 'bold';
    text.fontSize = 140;
    text.textHorizontalAlignment = TextBlock.HORIZONTAL_ALIGNMENT_CENTER;
    text.textVerticalAlignment = TextBlock.VERTICAL_ALIGNMENT_CENTER;
    adt.addControl(text);
  } else {
    // No name set — keep the panel a solid white plate (no ADT, so the
    // signWhite material stays applied and the panel renders correctly).
  }

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
  // Solid trim-coloured frame box was reading as opaque "brown panes."
  // Replaced with proud-of-wall glass plates + a 4-piece trim border.
  const winH = spec.doorHeight - 0.3;
  const winY = winH / 2 + 0.4;
  const winW = (shopW - spec.doorWidth - 2) / 2 - 0.6;
  const frameT = 0.12;
  for (const side of [-1, 1]) {
    const xCenter = side * (spec.doorWidth / 2 + 0.6 + winW / 2);
    const winZ = -shopD / 2 - 0.04;
    const glass = MeshBuilder.CreateBox(`shopWin_${id}_${side}`, {
      width: winW, height: winH, depth: 0.06,
    }, scene);
    glass.parent = body;
    glass.position.set(xCenter, winY, winZ);
    glass.material = glassMat;
    const top = MeshBuilder.CreateBox(`shopWinT_${id}_${side}`, { width: winW + frameT * 2, height: frameT, depth: 0.08 }, scene);
    top.parent = body; top.position.set(xCenter, winY + winH / 2 + frameT / 2, winZ); top.material = trimMat;
    const bot = MeshBuilder.CreateBox(`shopWinB_${id}_${side}`, { width: winW + frameT * 2, height: frameT, depth: 0.08 }, scene);
    bot.parent = body; bot.position.set(xCenter, winY - winH / 2 - frameT / 2, winZ); bot.material = trimMat;
    const lj = MeshBuilder.CreateBox(`shopWinL_${id}_${side}`, { width: frameT, height: winH, depth: 0.08 }, scene);
    lj.parent = body; lj.position.set(xCenter - winW / 2 - frameT / 2, winY, winZ); lj.material = trimMat;
    const rj = MeshBuilder.CreateBox(`shopWinR_${id}_${side}`, { width: frameT, height: winH, depth: 0.08 }, scene);
    rj.parent = body; rj.position.set(xCenter + winW / 2 + frameT / 2, winY, winZ); rj.material = trimMat;
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
    if (isRoofMesh(m.name) || m.getAbsolutePosition().y > 2.5) roofMeshes.push(m);
  }

  return {
    root,
    exteriorCasters,
    collisionWalls,
    roofMeshes,
    centerXZ: [position.x, position.z],
    halfExtentsXZ: [shopW / 2, shopD / 2],
    interiorHeight: wallH,
  };
}
