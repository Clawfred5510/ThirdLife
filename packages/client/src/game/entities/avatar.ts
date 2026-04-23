import {
  Scene,
  MeshBuilder,
  Mesh,
  Vector3,
  Color3,
  Color4,
  StandardMaterial,
  TransformNode,
} from '@babylonjs/core';
import type { Appearance } from '@gamestu/shared';
import {
  DEFAULT_APPEARANCE,
  AVATAR_WALK_SPEED_THRESHOLD,
  AVATAR_WALK_FREQ,
  AVATAR_WALK_LEG_SWING,
  AVATAR_WALK_ARM_SWING,
  AVATAR_WALK_BOB,
  AVATAR_IDLE_BOB,
  AVATAR_IDLE_FREQ,
} from '@gamestu/shared';

function hexToColor3(hex: string): Color3 {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return new Color3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function outline(mesh: Mesh): void {
  mesh.renderOutline = true;
  mesh.outlineWidth = 0.012;
  mesh.outlineColor = Color3.Black();
}

function matte(scene: Scene, name: string): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.specularColor = Color3.Black();
  return m;
}

// -----------------------------------------------------------------------
// Avatar interface — all animatable limbs exposed for procedural walk
// -----------------------------------------------------------------------

export interface Avatar {
  root: TransformNode;

  // Core body parts
  body: Mesh;
  legs: Mesh;
  head: Mesh;
  shoeL: Mesh;
  shoeR: Mesh;

  // Arms (new)
  armUpperL: TransformNode;
  armUpperR: TransformNode;
  armLowerL: Mesh;
  armLowerR: Mesh;
  handL: Mesh;
  handR: Mesh;

  // Leg pivots for walk animation
  legPivotL: TransformNode;
  legPivotR: TransformNode;
  legMeshL: Mesh;
  legMeshR: Mesh;

  // Eyes (face)
  eyeL: Mesh;
  eyeR: Mesh;

  // Accessories
  hat: Mesh | null;
  accessory: Mesh | null;

  // Materials
  bodyMat: StandardMaterial;
  legsMat: StandardMaterial;
  headMat: StandardMaterial;
  shoesMat: StandardMaterial;
  hatMat: StandardMaterial;
  accessoryMat: StandardMaterial;
  armMat: StandardMaterial;
}

// -----------------------------------------------------------------------
// Build avatar — Roblox-ish proportions (~3.5 heads tall, big head,
// stubby limbs, rounded everywhere, dot eyes)
// -----------------------------------------------------------------------

/*
  Layout (y from feet at 0):
    0.0  .. 0.12  shoes
    0.1  .. 0.75  legs (two separate capsules on pivots)
    0.75 .. 1.45  torso (wider capsule)
    1.0  .. 1.45  arms hang from shoulder height ~1.3
    1.45 .. 1.95  head (sphere, scaled wider)
    1.95+         hat
*/

export function buildAvatar(
  scene: Scene,
  id: string,
  appearance: Appearance = DEFAULT_APPEARANCE,
): Avatar {
  const root = new TransformNode(`avatar_${id}`, scene);

  // --- Materials (shared per avatar, mutated by applyAppearance) ---
  const bodyMat = matte(scene, `bodyMat_${id}`);
  const legsMat = matte(scene, `legsMat_${id}`);
  const headMat = matte(scene, `headMat_${id}`);
  const shoesMat = matte(scene, `shoesMat_${id}`);
  const hatMat = matte(scene, `hatMat_${id}`);
  const accessoryMat = matte(scene, `accMat_${id}`);
  const armMat = matte(scene, `armMat_${id}`);

  const eyeMat = matte(scene, `eyeMat_${id}`);
  eyeMat.diffuseColor = new Color3(0.08, 0.08, 0.08);

  // --- Legs (two separate capsules on pivots for walk animation) ---
  const legPivotL = new TransformNode(`legPivotL_${id}`, scene);
  legPivotL.parent = root;
  legPivotL.position.set(-0.12, 0.7, 0);
  const legMeshL = MeshBuilder.CreateCapsule(`legL_${id}`, {
    height: 0.6, radius: 0.12, tessellation: 10, subdivisions: 1,
  }, scene);
  legMeshL.parent = legPivotL;
  legMeshL.position.y = -0.28;
  legMeshL.material = legsMat;
  outline(legMeshL);

  const legPivotR = new TransformNode(`legPivotR_${id}`, scene);
  legPivotR.parent = root;
  legPivotR.position.set(0.12, 0.7, 0);
  const legMeshR = MeshBuilder.CreateCapsule(`legR_${id}`, {
    height: 0.6, radius: 0.12, tessellation: 10, subdivisions: 1,
  }, scene);
  legMeshR.parent = legPivotR;
  legMeshR.position.y = -0.28;
  legMeshR.material = legsMat;
  outline(legMeshR);

  // Keep a dummy "legs" mesh ref for appearance compatibility
  const legs = legMeshL;

  // --- Shoes ---
  const shoeL = MeshBuilder.CreateCapsule(`shoeL_${id}`, {
    height: 0.14, radius: 0.1, tessellation: 8, subdivisions: 1,
  }, scene);
  shoeL.parent = legPivotL;
  shoeL.position.set(0, -0.56, 0.02);
  shoeL.material = shoesMat;
  outline(shoeL);

  const shoeR = MeshBuilder.CreateCapsule(`shoeR_${id}`, {
    height: 0.14, radius: 0.1, tessellation: 8, subdivisions: 1,
  }, scene);
  shoeR.parent = legPivotR;
  shoeR.position.set(0, -0.56, 0.02);
  shoeR.material = shoesMat;
  outline(shoeR);

  // --- Torso ---
  const body = MeshBuilder.CreateCapsule(`body_${id}`, {
    height: 0.7, radius: 0.28, tessellation: 14, subdivisions: 1,
  }, scene);
  body.parent = root;
  body.position.y = 1.1;
  body.scaling.set(1.1, 1, 0.85); // wider shoulders, slightly flat front-to-back
  body.material = bodyMat;
  outline(body);

  // --- Arms (upper arm pivot -> upper capsule -> forearm -> hand) ---
  const shoulderY = 1.28;

  // Left arm
  const armUpperL = new TransformNode(`armPivotL_${id}`, scene);
  armUpperL.parent = root;
  armUpperL.position.set(-0.38, shoulderY, 0);
  const armUpperMeshL = MeshBuilder.CreateCapsule(`armUL_${id}`, {
    height: 0.35, radius: 0.08, tessellation: 8, subdivisions: 1,
  }, scene);
  armUpperMeshL.parent = armUpperL;
  armUpperMeshL.position.y = -0.16;
  armUpperMeshL.material = armMat;
  outline(armUpperMeshL);

  const armLowerL = MeshBuilder.CreateCapsule(`armLL_${id}`, {
    height: 0.3, radius: 0.07, tessellation: 8, subdivisions: 1,
  }, scene);
  armLowerL.parent = armUpperL;
  armLowerL.position.y = -0.42;
  armLowerL.material = bodyMat; // forearm = shirt color
  outline(armLowerL);

  const handL = MeshBuilder.CreateSphere(`handL_${id}`, { diameter: 0.14, segments: 8 }, scene);
  handL.parent = armUpperL;
  handL.position.y = -0.6;
  handL.material = headMat; // hand = skin color
  outline(handL);

  // Right arm
  const armUpperR = new TransformNode(`armPivotR_${id}`, scene);
  armUpperR.parent = root;
  armUpperR.position.set(0.38, shoulderY, 0);
  const armUpperMeshR = MeshBuilder.CreateCapsule(`armUR_${id}`, {
    height: 0.35, radius: 0.08, tessellation: 8, subdivisions: 1,
  }, scene);
  armUpperMeshR.parent = armUpperR;
  armUpperMeshR.position.y = -0.16;
  armUpperMeshR.material = armMat;
  outline(armUpperMeshR);

  const armLowerR = MeshBuilder.CreateCapsule(`armLR_${id}`, {
    height: 0.3, radius: 0.07, tessellation: 8, subdivisions: 1,
  }, scene);
  armLowerR.parent = armUpperR;
  armLowerR.position.y = -0.42;
  armLowerR.material = bodyMat;
  outline(armLowerR);

  const handR = MeshBuilder.CreateSphere(`handR_${id}`, { diameter: 0.14, segments: 8 }, scene);
  handR.parent = armUpperR;
  handR.position.y = -0.6;
  handR.material = headMat;
  outline(handR);

  // --- Head (wider sphere for Roblox chibi feel) ---
  const head = MeshBuilder.CreateSphere(`head_${id}`, { diameter: 0.56, segments: 16 }, scene);
  head.parent = root;
  head.position.y = 1.68;
  head.scaling.set(1.15, 1.0, 1.0); // wider face
  head.material = headMat;
  outline(head);

  // --- Face: dot eyes ---
  const eyeL = MeshBuilder.CreateSphere(`eyeL_${id}`, { diameter: 0.06, segments: 6 }, scene);
  eyeL.parent = head;
  eyeL.position.set(-0.1, 0.04, -0.24);
  eyeL.material = eyeMat;

  const eyeR = MeshBuilder.CreateSphere(`eyeR_${id}`, { diameter: 0.06, segments: 6 }, scene);
  eyeR.parent = head;
  eyeR.position.set(0.1, 0.04, -0.24);
  eyeR.material = eyeMat;

  const avatar: Avatar = {
    root, body, legs, head, shoeL, shoeR,
    armUpperL, armUpperR, armLowerL, armLowerR, handL, handR,
    legPivotL, legPivotR, legMeshL, legMeshR,
    eyeL, eyeR,
    hat: null, accessory: null,
    bodyMat, legsMat, headMat, shoesMat, hatMat, accessoryMat, armMat,
  };

  applyAppearance(scene, avatar, appearance);
  return avatar;
}

// -----------------------------------------------------------------------
// Appearance application (colors + hat/accessory rebuild)
// -----------------------------------------------------------------------

export function applyAppearance(
  scene: Scene,
  avatar: Avatar,
  appearance: Appearance,
): void {
  avatar.bodyMat.diffuseColor = hexToColor3(appearance.shirt_color);
  avatar.legsMat.diffuseColor = hexToColor3(appearance.pants_color);
  avatar.headMat.diffuseColor = hexToColor3(appearance.body_color);
  avatar.shoesMat.diffuseColor = hexToColor3(appearance.shoes_color);
  avatar.hatMat.diffuseColor = hexToColor3(appearance.hat_color);
  avatar.accessoryMat.diffuseColor = hexToColor3(appearance.accessory_color);
  // Arms = skin color (upper arm shows skin below short sleeves)
  avatar.armMat.diffuseColor = hexToColor3(appearance.body_color);

  if (avatar.hat) { avatar.hat.dispose(); avatar.hat = null; }
  if (appearance.hat_style !== 'none') {
    avatar.hat = buildHat(scene, avatar.root.name, appearance.hat_style);
    avatar.hat.parent = avatar.root;
    avatar.hat.material = avatar.hatMat;
  }

  if (avatar.accessory) { avatar.accessory.dispose(); avatar.accessory = null; }
  if (appearance.accessory_style !== 'none') {
    avatar.accessory = buildAccessory(scene, avatar.root.name, appearance.accessory_style);
    avatar.accessory.parent = avatar.root;
    avatar.accessory.material = avatar.accessoryMat;
  }
}

// -----------------------------------------------------------------------
// Procedural walk / idle animation — call once per frame
// -----------------------------------------------------------------------

/** Cached accessibility preference: re-read occasionally in case it changes. */
let prefersReducedMotion = false;
let lastRMCheck = 0;
function checkReducedMotion(time: number): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  if (time - lastRMCheck > 2) {
    prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    lastRMCheck = time;
  }
  return prefersReducedMotion;
}

export function animateAvatar(
  avatar: Avatar,
  velocity: number,  // magnitude of horizontal movement speed (world units/s)
  dt: number,        // seconds since last frame
  time: number,      // running clock (performance.now() / 1000)
): void {
  // Respect prefers-reduced-motion: pin limbs at rest, no bob
  if (checkReducedMotion(time)) {
    avatar.legPivotL.rotation.x = 0;
    avatar.legPivotR.rotation.x = 0;
    avatar.armUpperL.rotation.x = 0;
    avatar.armUpperR.rotation.x = 0;
    avatar.body.position.y = 1.1;
    avatar.head.position.y = 1.68;
    return;
  }

  const isWalking = velocity > AVATAR_WALK_SPEED_THRESHOLD;

  if (isWalking) {
    const t = time * AVATAR_WALK_FREQ;
    const legAngle = Math.sin(t * Math.PI) * AVATAR_WALK_LEG_SWING;
    const armAngle = Math.sin(t * Math.PI) * AVATAR_WALK_ARM_SWING;

    avatar.legPivotL.rotation.x = legAngle;
    avatar.legPivotR.rotation.x = -legAngle;

    avatar.armUpperL.rotation.x = -armAngle;
    avatar.armUpperR.rotation.x = armAngle;

    avatar.body.position.y = 1.1 + Math.abs(Math.sin(t * Math.PI * 2)) * AVATAR_WALK_BOB;
    avatar.head.position.y = 1.68 - Math.abs(Math.sin(t * Math.PI * 2)) * AVATAR_WALK_BOB * 0.3;
  } else {
    const t = time * AVATAR_IDLE_FREQ;
    const bob = Math.sin(t * Math.PI * 2) * AVATAR_IDLE_BOB;

    avatar.body.position.y = 1.1 + bob;
    avatar.head.position.y = 1.68 + bob * 0.5;

    avatar.legPivotL.rotation.x *= 0.85;
    avatar.legPivotR.rotation.x *= 0.85;
    avatar.armUpperL.rotation.x *= 0.85;
    avatar.armUpperR.rotation.x *= 0.85;
  }
}

// -----------------------------------------------------------------------
// Hat builders
// -----------------------------------------------------------------------

function buildHat(scene: Scene, avatarId: string, style: Exclude<Appearance['hat_style'], 'none'>): Mesh {
  switch (style) {
    case 'cap': {
      const hat = MeshBuilder.CreateCylinder(`hat_cap_${avatarId}`, {
        height: 0.14, diameterTop: 0.5, diameterBottom: 0.55, tessellation: 18,
      }, scene);
      hat.position.y = 1.92;
      outline(hat);
      const brim = MeshBuilder.CreateCylinder(`hat_capBrim_${avatarId}`, {
        height: 0.02, diameter: 0.68, tessellation: 18,
      }, scene);
      brim.parent = hat;
      brim.position.set(0, -0.07, 0.08);
      return hat;
    }
    case 'tophat': {
      const hat = MeshBuilder.CreateCylinder(`hat_top_${avatarId}`, {
        height: 0.4, diameterTop: 0.4, diameterBottom: 0.4, tessellation: 20,
      }, scene);
      hat.position.y = 2.12;
      outline(hat);
      const brim = MeshBuilder.CreateCylinder(`hat_topBrim_${avatarId}`, {
        height: 0.03, diameter: 0.64, tessellation: 20,
      }, scene);
      brim.parent = hat;
      brim.position.y = -0.2;
      return hat;
    }
    case 'beanie': {
      const hat = MeshBuilder.CreateSphere(`hat_beanie_${avatarId}`, {
        diameter: 0.52, segments: 12, slice: 0.55,
      }, scene);
      hat.position.y = 1.82;
      outline(hat);
      return hat;
    }
  }
}

// -----------------------------------------------------------------------
// Accessory builders
// -----------------------------------------------------------------------

function buildAccessory(
  scene: Scene,
  avatarId: string,
  style: Exclude<Appearance['accessory_style'], 'none'>,
): Mesh {
  switch (style) {
    case 'chain': {
      const chain = MeshBuilder.CreateTorus(`acc_chain_${avatarId}`, {
        diameter: 0.42, thickness: 0.04, tessellation: 24,
      }, scene);
      chain.position.y = 1.42;
      chain.rotation.x = Math.PI / 2;
      outline(chain);
      return chain;
    }
    case 'sunglasses': {
      const bar = MeshBuilder.CreateBox(`acc_glasses_${avatarId}`, {
        width: 0.44, height: 0.1, depth: 0.04,
      }, scene);
      bar.position.set(0, 1.72, -0.26);
      outline(bar);
      return bar;
    }
    case 'bowtie': {
      const bow = MeshBuilder.CreateBox(`acc_bow_${avatarId}`, {
        width: 0.2, height: 0.1, depth: 0.05,
      }, scene);
      bow.position.set(0, 1.42, -0.28);
      bow.rotation.z = Math.PI / 10;
      outline(bow);
      return bow;
    }
  }
}

// -----------------------------------------------------------------------
// Cleanup
// -----------------------------------------------------------------------

export function disposeAvatar(avatar: Avatar): void {
  avatar.hat?.dispose();
  avatar.accessory?.dispose();
  avatar.root.dispose(false, true);
}
