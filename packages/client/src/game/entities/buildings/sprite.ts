import {
  Scene,
  MeshBuilder,
  Vector3,
  TransformNode,
  StandardMaterial,
  Texture,
  Color3,
  Mesh,
  AbstractMesh,
} from '@babylonjs/core';
import { BuildingSpec, BuildingOutput } from './shared';

/**
 * Sprite-billboard building renderer (Phase F aesthetic pass).
 *
 * Each known building type maps to a hand-painted PNG diorama under
 * /assets/buildings/. We render a single Y-billboarded plane so the
 * sprite always faces the camera while staying upright on the ground
 * (avatars walk around it, the painted artwork rotates to track yaw).
 *
 * Trade-offs vs the legacy procedural meshes:
 *   - 100% match for the cozy/painterly art direction (the source PNGs
 *     are already rendered in the target style).
 *   - No interior — buildings are decorative shells. Collision is a
 *     small invisible box at the base.
 *   - Massive code/complexity drop (procedural meshes were ~200 lines
 *     each per type).
 *
 * Asset path resolution: buildings/<type>.png. `shop` reuses store.png
 * since they're the same building. `market` falls back to store.png
 * for now until we have a dedicated asset.
 */

const ASSET_BY_TYPE: Record<string, string> = {
  apartment: '/assets/buildings/apartment.png',
  bank:      '/assets/buildings/bank.png',
  factory:   '/assets/buildings/factory.png',
  farm:      '/assets/buildings/farm.png',
  hall:      '/assets/buildings/hall.png',
  house:     '/assets/buildings/house.png',
  mine:      '/assets/buildings/mine.png',
  office:    '/assets/buildings/office.png',
  shop:      '/assets/buildings/store.png',
  market:    '/assets/buildings/store.png', // shares the store sprite for now
  // Phase D extended types — no bespoke art yet, fall through to legacy.
};

export function hasSpriteAsset(buildingType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ASSET_BY_TYPE, buildingType);
}

// Cache textures across builds — every new claim should hit the GPU
// once, not re-fetch.
const textureCache = new Map<string, Texture>();
function getTexture(scene: Scene, url: string): Texture {
  let t = textureCache.get(url);
  if (!t) {
    t = new Texture(url, scene, false, false);
    t.hasAlpha = true;
    textureCache.set(url, t);
  }
  return t;
}

const materialCache = new Map<string, StandardMaterial>();
function getMaterial(scene: Scene, type: string): StandardMaterial {
  let m = materialCache.get(type);
  if (!m) {
    const url = ASSET_BY_TYPE[type];
    m = new StandardMaterial(`spriteMat_${type}`, scene);
    m.diffuseTexture = getTexture(scene, url);
    m.useAlphaFromDiffuseTexture = true;
    m.opacityTexture = m.diffuseTexture; // alpha cutout via the same tex
    m.specularColor = new Color3(0, 0, 0); // matte — no plastic shine
    m.emissiveColor = new Color3(0.7, 0.65, 0.55); // warm ambient lift so the sprite reads even in shadow
    m.disableLighting = false;
    m.backFaceCulling = false;
    m.useAlphaFromDiffuseTexture = true;
    materialCache.set(type, m);
  }
  return m;
}

/**
 * Build a sprite-billboard building. The visual is a 32u-wide × 28u-
 * tall plane positioned so its base sits on the ground at `position`.
 * Collision is a small invisible box at the footprint so players can't
 * walk through the building.
 */
export function buildSpriteBuilding(
  scene: Scene,
  id: string | number,
  position: Vector3,
  spec: BuildingSpec,
  buildingType: string,
): BuildingOutput {
  const root = new TransformNode(`sprite_${buildingType}_${id}`, scene);
  root.position.copyFrom(position);

  // Plane size — tuned to one parcel (40u stride). Width 32 leaves a
  // small margin from the road; height 28 keeps the painted base visible
  // while the rooftops still feel proper relative to the avatar.
  const planeW = 32;
  const planeH = 28;

  const plane = MeshBuilder.CreatePlane(`spritePlane_${buildingType}_${id}`, {
    width: planeW,
    height: planeH,
    sideOrientation: Mesh.DOUBLESIDE,
  }, scene);
  plane.parent = root;
  plane.position.y = planeH / 2; // base on the ground
  plane.material = getMaterial(scene, buildingType);
  // Y-billboard: rotate around vertical so the sprite always faces the
  // camera but stays upright. Exactly the diorama-card behavior.
  plane.billboardMode = Mesh.BILLBOARDMODE_Y;
  plane.receiveShadows = false;
  plane.isPickable = false;

  // Collision footprint — a thin invisible box at the building base.
  // 24u × 24u centered on the parcel; tall enough that the player can't
  // jump over it. Matches roughly where the painted facade sits.
  const collFoot = 24;
  const collH = 8;
  const collider = MeshBuilder.CreateBox(`spriteCol_${buildingType}_${id}`, {
    width: collFoot, height: collH, depth: collFoot,
  }, scene);
  collider.parent = root;
  collider.position.y = collH / 2;
  collider.isVisible = false;
  collider.checkCollisions = true;

  void spec; // unused for sprite path — footprint stays parcel-sized

  return {
    root,
    exteriorCasters: [],     // no shadow-casting needed; sprite has its own painted shadows
    collisionWalls: [collider],
    roofMeshes: [],          // nothing to fade when the player is "inside" — there is no inside
    centerXZ: [position.x, position.z],
    halfExtentsXZ: [planeW / 2, planeW / 2],
    interiorHeight: planeH,
  };
}
