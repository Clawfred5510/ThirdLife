/**
 * rocketCenterpiece.ts
 *
 * Builds the "COMING SOON" rocket landmark at world origin.
 * Call buildRocket(scene, position) once after the parcel grid is spawned.
 * Returns a TransformNode that owns all child meshes — dispose the node to
 * clean up everything (materials are in the shared scene cache and will be
 * cleaned up by the scene itself).
 */

import {
  Scene,
  MeshBuilder,
  TransformNode,
  Vector3,
  Color3,
} from '@babylonjs/core';
import { AdvancedDynamicTexture, TextBlock } from '@babylonjs/gui';
import { mat } from './buildings/shared';

export function buildRocket(scene: Scene, position: Vector3): TransformNode {
  const root = new TransformNode('rocketCenterpiece', scene);
  root.position.copyFrom(position);

  // ── Materials ────────────────────────────────────────────────────────────

  const mBody     = mat(scene, 'rkt-body',    '#F5EFE0', 0.75);
  const mFin      = mat(scene, 'rkt-fin',     '#E05A3A', 0.70);
  const mPad      = mat(scene, 'rkt-pad',     '#8C8070', 0.90, { metallic: 0.1 });
  const mGlass    = mat(scene, 'rkt-glass',   '#A8D4F0', 0.10, {
    emissive: new Color3(0.3, 0.5, 0.7),
  });
  const mExhaust  = mat(scene, 'rkt-exhaust', '#C8A050', 0.35, {
    metallic: 0.65,
    emissive: new Color3(0.4, 0.25, 0.05),
  });
  const mSign     = mat(scene, 'rkt-sign',    '#FFFAE8', 0.65, {
    emissive: new Color3(0.18, 0.16, 0.08),
  });

  // ── Launchpad disc ───────────────────────────────────────────────────────

  const pad = MeshBuilder.CreateCylinder('rkt_pad', {
    diameter: 32,
    height: 1.2,
    tessellation: 36,
  }, scene);
  pad.parent = root;
  pad.position.y = 0.6;
  pad.material = mPad;

  // ── Torus rim on pad ─────────────────────────────────────────────────────

  const rim = MeshBuilder.CreateTorus('rkt_rim', {
    diameter: 30,
    thickness: 0.8,
    tessellation: 48,
  }, scene);
  rim.parent = root;
  rim.position.y = 1.2;
  rim.material = mFin;

  // ── Exhaust torus ring ───────────────────────────────────────────────────

  const exhaust = MeshBuilder.CreateTorus('rkt_exhaust', {
    diameter: 8,
    thickness: 1.2,
    tessellation: 36,
  }, scene);
  exhaust.parent = root;
  exhaust.position.y = 1.4;
  exhaust.material = mExhaust;

  // ── 4 side boosters at ±8 X/Z at 45° offsets ────────────────────────────

  const boosterOffsets = [
    { x:  8, z:  8 },
    { x: -8, z:  8 },
    { x:  8, z: -8 },
    { x: -8, z: -8 },
  ];

  for (let i = 0; i < boosterOffsets.length; i++) {
    const off = boosterOffsets[i];
    const booster = MeshBuilder.CreateCylinder(`rkt_booster${i}`, {
      diameterBottom: 3.5,
      diameterTop: 2,
      height: 14,
      tessellation: 16,
    }, scene);
    booster.parent = root;
    booster.position.set(off.x, 8, off.z);
    booster.material = mFin;
  }

  // ── 4 swept fins (boxes, one at each 45°/135°/225°/315°) ─────────────────

  const finAngles = [45, 135, 225, 315];
  for (let i = 0; i < finAngles.length; i++) {
    const angleDeg = finAngles[i];
    const angleRad = (angleDeg * Math.PI) / 180;
    const fin = MeshBuilder.CreateBox(`rkt_fin${i}`, {
      width: 0.4,
      height: 12,
      depth: 9,
    }, scene);
    fin.parent = root;
    // Bottom of fin at y=0: center at y=6
    fin.position.set(
      Math.sin(angleRad) * 6,
      6,
      Math.cos(angleRad) * 6,
    );
    fin.rotation.y = -angleRad;
    fin.material = mFin;
  }

  // ── Main body ────────────────────────────────────────────────────────────

  const body = MeshBuilder.CreateCylinder('rkt_body', {
    diameter: 10,
    height: 42,
    tessellation: 24,
  }, scene);
  body.parent = root;
  body.position.y = 22; // center at y=22, bottom at y=1
  body.material = mBody;

  // ── Collar at base ───────────────────────────────────────────────────────

  const collar = MeshBuilder.CreateCylinder('rkt_collar', {
    diameter: 12,
    height: 1.5,
    tessellation: 24,
  }, scene);
  collar.parent = root;
  collar.position.y = 2.5;
  collar.material = mBody;

  // ── 2 decorative bands ───────────────────────────────────────────────────

  const bandPositions = [22, 36];
  for (let i = 0; i < bandPositions.length; i++) {
    const band = MeshBuilder.CreateCylinder(`rkt_band${i}`, {
      diameter: 10.5,
      height: 1.2,
      tessellation: 24,
    }, scene);
    band.parent = root;
    band.position.y = bandPositions[i];
    band.material = mBody;
  }

  // ── Nose cone ────────────────────────────────────────────────────────────

  const nose = MeshBuilder.CreateCylinder('rkt_nose', {
    diameterBottom: 10,
    diameterTop: 0.5,
    height: 18,
    tessellation: 24,
  }, scene);
  nose.parent = root;
  nose.position.y = 52.2; // bottom at y=43.2 (body top=43), center at 52.2
  nose.material = mBody;

  // ── 3 portholes facing the spawn (south face, z=-5.1) ──────────────────
  // Player spawns at z=-80 looking +Z; the rocket's south face (-Z) is the
  // side they see. Portholes were originally placed at +5.1 (the rear/back
  // of the rocket from spawn POV) which made them invisible from spawn —
  // visible only when the player walked behind the rocket.

  const portholeYs = [30, 34, 38];
  for (let i = 0; i < portholeYs.length; i++) {
    const porthole = MeshBuilder.CreateSphere(`rkt_porthole${i}`, {
      diameter: 2.8,
      segments: 12,
    }, scene);
    porthole.parent = root;
    porthole.position.set(0, portholeYs[i], -5.1);
    porthole.material = mGlass;
  }

  // ── Hazard cones × 8 around radius 18 ────────────────────────────────────

  const mCone = mat(scene, 'rkt-cone', '#E8621A', 0.80);
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const cone = MeshBuilder.CreateCylinder(`rkt_cone${i}`, {
      diameterBottom: 0.6,
      diameterTop: 0.1,
      height: 1.2,
      tessellation: 8,
    }, scene);
    cone.parent = root;
    cone.position.set(Math.sin(angle) * 18, 0.6, Math.cos(angle) * 18);
    cone.material = mCone;
  }

  // ── Fence ring at radius 20: 16 posts + rails, gap at south (skip ~170° and ~190°) ──

  const mFencePost = mat(scene, 'rkt-fence', '#A09080', 0.85);
  const POST_COUNT = 16;
  const FENCE_RADIUS = 20;
  // Indices 12 and 13 map to ~270° → we want south gap at ~170°/190°.
  // South = negative Z in Babylon. Angle 0 = +Z. 180° = -Z (south).
  // 170° index from 16 posts: index = round(170/360 * 16) = index 7 (168.75°)
  // 190° index: round(190/360 * 16) = index 8 (180° = index 8, 202.5° = index 9)
  // Skip indices 7 and 8 to open a gate at south.
  const SKIP_SOUTH = new Set([7, 8]);

  // Build posts
  const postPositions: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < POST_COUNT; i++) {
    const angle = (i / POST_COUNT) * Math.PI * 2;
    const px = Math.sin(angle) * FENCE_RADIUS;
    const pz = Math.cos(angle) * FENCE_RADIUS;
    postPositions.push({ x: px, z: pz });

    if (SKIP_SOUTH.has(i)) continue;

    const post = MeshBuilder.CreateBox(`rkt_fpost${i}`, {
      width: 0.2,
      height: 2.4,
      depth: 0.2,
    }, scene);
    post.parent = root;
    post.position.set(px, 1.2, pz);
    post.material = mFencePost;
  }

  // Build rails between adjacent posts, skipping spans adjacent to the gap
  // (skip spans from i→i+1 where either i or i+1 is in SKIP_SOUTH)
  for (let i = 0; i < POST_COUNT; i++) {
    const next = (i + 1) % POST_COUNT;
    if (SKIP_SOUTH.has(i) || SKIP_SOUTH.has(next)) continue;

    const a = postPositions[i];
    const b = postPositions[next];
    const cx = (a.x + b.x) / 2;
    const cz = (a.z + b.z) / 2;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const segLen = Math.hypot(dx, dz);
    const railAngle = -Math.atan2(dz, dx);

    for (const ry of [0.8, 1.6]) {
      const rail = MeshBuilder.CreateBox(`rkt_rail${i}_y${ry}`, {
        width: segLen - 0.05,
        height: 0.15,
        depth: 0.15,
      }, scene);
      rail.parent = root;
      rail.position.set(cx, ry, cz);
      rail.rotation.y = railAngle;
      rail.material = mFencePost;
    }
  }

  // ── "COMING SOON" sign ───────────────────────────────────────────────────
  // Two posts + one billboard panel at z=-17 (south-facing, toward spawn)

  const mSignPost = mat(scene, 'rkt-signpost', '#706050', 0.88);

  for (const sx of [-4, 4]) {
    const signPost = MeshBuilder.CreateBox(`rkt_signpost_${sx}`, {
      width: 0.3,
      height: 6,
      depth: 0.3,
    }, scene);
    signPost.parent = root;
    signPost.position.set(sx, 3, -17);
    signPost.material = mSignPost;
  }

  const panel = MeshBuilder.CreateBox('rkt_signpanel', {
    width: 14,
    height: 4.5,
    depth: 0.25,
  }, scene);
  panel.parent = root;
  panel.position.set(0, 6.25, -17.1);
  panel.material = mSign;

  // GUI texture on the panel face
  const panelTex = AdvancedDynamicTexture.CreateForMesh(panel, 512, 128);
  const tb = new TextBlock('rkt_signtext', 'COMING SOON');
  tb.color = '#1A1208';
  tb.fontFamily = 'Arial';
  tb.fontSize = 72;
  tb.fontWeight = 'bold';
  tb.textHorizontalAlignment = TextBlock.HORIZONTAL_ALIGNMENT_CENTER;
  tb.textVerticalAlignment = TextBlock.VERTICAL_ALIGNMENT_CENTER;
  panelTex.background = '#FFFAE8';
  panelTex.addControl(tb);

  return root;
}
