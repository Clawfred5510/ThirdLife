import {
  Scene,
  MeshBuilder,
  Mesh,
  Vector3,
  Color3,
  StandardMaterial,
  TransformNode,
} from '@babylonjs/core';
import type { Appearance } from '@gamestu/shared';
import { DEFAULT_APPEARANCE } from '@gamestu/shared';

function hexToColor3(hex: string): Color3 {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return new Color3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/**
 * Bundle of meshes that make up a humanoid avatar. We keep one Avatar per
 * player so appearance updates can mutate in place instead of disposing
 * and rebuilding (cheaper, avoids camera lock targets going stale).
 */
export interface Avatar {
  root: TransformNode;
  body: Mesh;        // shirt (upper half) — also the "main" mesh the camera locks on
  legs: Mesh;        // pants (lower half)
  head: Mesh;
  shoeL: Mesh;
  shoeR: Mesh;
  hat: Mesh | null;
  accessory: Mesh | null;

  bodyMat: StandardMaterial;
  legsMat: StandardMaterial;
  headMat: StandardMaterial;
  shoesMat: StandardMaterial;
  hatMat: StandardMaterial;
  accessoryMat: StandardMaterial;
}

/**
 * Build an avatar rooted at (0,0,0). Caller positions the `root` and
 * uses `.body` as the camera target.
 *
 * Geometry layout (all relative to root at the capsule's feet):
 *   y=0.0 .. 0.15  — shoes
 *   y=0.1 .. 0.9   — legs / pants (lower capsule)
 *   y=0.9 .. 1.7   — body / shirt (upper capsule)
 *   y=1.7 .. 1.95  — head
 *   y=1.95+        — hat
 */
export function buildAvatar(
  scene: Scene,
  id: string,
  appearance: Appearance = DEFAULT_APPEARANCE,
): Avatar {
  const root = new TransformNode(`avatar_${id}`, scene);

  // Legs / pants — lower half of body as a capsule
  const legs = MeshBuilder.CreateCapsule(`legs_${id}`, {
    height: 0.9,
    radius: 0.28,
    tessellation: 12,
    subdivisions: 1,
  }, scene);
  legs.parent = root;
  legs.position.y = 0.5;
  const legsMat = new StandardMaterial(`legsMat_${id}`, scene);
  legs.material = legsMat;

  // Body / shirt — upper capsule
  const body = MeshBuilder.CreateCapsule(`body_${id}`, {
    height: 0.9,
    radius: 0.3,
    tessellation: 12,
    subdivisions: 1,
  }, scene);
  body.parent = root;
  body.position.y = 1.3;
  const bodyMat = new StandardMaterial(`bodyMat_${id}`, scene);
  body.material = bodyMat;

  // Head sphere
  const head = MeshBuilder.CreateSphere(`head_${id}`, { diameter: 0.4, segments: 10 }, scene);
  head.parent = root;
  head.position.y = 1.85;
  const headMat = new StandardMaterial(`headMat_${id}`, scene);
  head.material = headMat;

  // Shoes — two boxes
  const shoesMat = new StandardMaterial(`shoesMat_${id}`, scene);
  const shoeL = MeshBuilder.CreateBox(`shoeL_${id}`, { width: 0.18, height: 0.12, depth: 0.3 }, scene);
  shoeL.parent = root;
  shoeL.position.set(-0.15, 0.06, 0.03);
  shoeL.material = shoesMat;
  const shoeR = MeshBuilder.CreateBox(`shoeR_${id}`, { width: 0.18, height: 0.12, depth: 0.3 }, scene);
  shoeR.parent = root;
  shoeR.position.set(0.15, 0.06, 0.03);
  shoeR.material = shoesMat;

  const hatMat = new StandardMaterial(`hatMat_${id}`, scene);
  const accessoryMat = new StandardMaterial(`accMat_${id}`, scene);

  const avatar: Avatar = {
    root, body, legs, head, shoeL, shoeR,
    hat: null, accessory: null,
    bodyMat, legsMat, headMat, shoesMat, hatMat, accessoryMat,
  };

  applyAppearance(scene, avatar, appearance);
  return avatar;
}

/**
 * Apply an appearance to an existing avatar: updates colours, rebuilds
 * hat & accessory geometry if the style changed, and handles "none" by
 * disposing the slot mesh.
 */
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

  // Hat: dispose + rebuild by style
  if (avatar.hat) { avatar.hat.dispose(); avatar.hat = null; }
  if (appearance.hat_style !== 'none') {
    avatar.hat = buildHat(scene, avatar.root.name, appearance.hat_style);
    avatar.hat.parent = avatar.root;
    avatar.hat.material = avatar.hatMat;
  }

  // Accessory: dispose + rebuild by style
  if (avatar.accessory) { avatar.accessory.dispose(); avatar.accessory = null; }
  if (appearance.accessory_style !== 'none') {
    avatar.accessory = buildAccessory(scene, avatar.root.name, appearance.accessory_style);
    avatar.accessory.parent = avatar.root;
    avatar.accessory.material = avatar.accessoryMat;
  }
}

function buildHat(scene: Scene, avatarId: string, style: Exclude<Appearance['hat_style'], 'none'>): Mesh {
  switch (style) {
    case 'cap': {
      const hat = MeshBuilder.CreateCylinder(`hat_cap_${avatarId}`, {
        height: 0.14,
        diameterTop: 0.42,
        diameterBottom: 0.48,
        tessellation: 16,
      }, scene);
      hat.position.y = 2.08;
      // Brim
      const brim = MeshBuilder.CreateCylinder(`hat_capBrim_${avatarId}`, {
        height: 0.02,
        diameter: 0.62,
        tessellation: 16,
      }, scene);
      brim.parent = hat;
      brim.position.y = -0.07;
      brim.position.z = 0.1;
      return hat;
    }
    case 'tophat': {
      const hat = MeshBuilder.CreateCylinder(`hat_top_${avatarId}`, {
        height: 0.38,
        diameterTop: 0.36,
        diameterBottom: 0.36,
        tessellation: 18,
      }, scene);
      hat.position.y = 2.22;
      const brim = MeshBuilder.CreateCylinder(`hat_topBrim_${avatarId}`, {
        height: 0.03,
        diameter: 0.58,
        tessellation: 18,
      }, scene);
      brim.parent = hat;
      brim.position.y = -0.19;
      return hat;
    }
    case 'beanie': {
      const hat = MeshBuilder.CreateSphere(`hat_beanie_${avatarId}`, {
        diameter: 0.45,
        segments: 10,
        slice: 0.55,
      }, scene);
      hat.position.y = 1.98;
      return hat;
    }
  }
}

function buildAccessory(
  scene: Scene,
  avatarId: string,
  style: Exclude<Appearance['accessory_style'], 'none'>,
): Mesh {
  switch (style) {
    case 'chain': {
      const chain = MeshBuilder.CreateTorus(`acc_chain_${avatarId}`, {
        diameter: 0.38,
        thickness: 0.05,
        tessellation: 24,
      }, scene);
      chain.position.y = 1.55;
      chain.rotation.x = Math.PI / 2;
      return chain;
    }
    case 'sunglasses': {
      // Two eye lenses bridged — merge into one mesh by creating one wide bar
      const bar = MeshBuilder.CreateBox(`acc_glasses_${avatarId}`, {
        width: 0.38,
        height: 0.09,
        depth: 0.06,
      }, scene);
      bar.position.y = 1.88;
      bar.position.z = -0.18;
      return bar;
    }
    case 'bowtie': {
      const bow = MeshBuilder.CreateBox(`acc_bow_${avatarId}`, {
        width: 0.22,
        height: 0.1,
        depth: 0.06,
      }, scene);
      bow.position.y = 1.6;
      bow.position.z = -0.3;
      bow.rotation.z = Math.PI / 8;
      return bow;
    }
  }
}

export function disposeAvatar(avatar: Avatar): void {
  avatar.hat?.dispose();
  avatar.accessory?.dispose();
  avatar.shoeL.dispose();
  avatar.shoeR.dispose();
  avatar.head.dispose();
  avatar.body.dispose();
  avatar.legs.dispose();
  avatar.root.dispose();
}
