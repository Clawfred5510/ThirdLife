/**
 * rocketCenterpiece.ts
 *
 * Loads the rocket landmark GLB at world origin (the town centerpiece).
 * Call buildRocket(scene, position) once after the parcel grid is spawned.
 * Returns a TransformNode that owns the model — dispose the node to clean up.
 *
 * 2026-05-31: replaced the old procedural "COMING SOON" rocket (capsules +
 * dynamic-texture sign) with the authored rocket.glb asset
 * (public/assets/models/environment/rocket.glb). The model is loaded async and
 * normalized to a fixed landmark height with its base resting on the ground,
 * centered on `position`.
 */

import {
  Scene,
  SceneLoader,
  TransformNode,
  Vector3,
} from '@babylonjs/core';

/** Target world-space height for the rocket centerpiece. Taller than the
 *  tier buildings (which fit a 32-unit footprint) so it reads as the town
 *  landmark. Tweak here to resize. */
const ROCKET_TARGET_HEIGHT = 24;

/** Optional yaw (radians) if the asset's "front" needs turning toward the
 *  spawn/camera side (players spawn south at z<0 facing +Z toward origin). */
const ROCKET_YAW = 0;

export function buildRocket(scene: Scene, position: Vector3): TransformNode {
  const root = new TransformNode('rocketCenterpiece', scene);
  root.position.copyFrom(position);

  // Wrap holds the model so normalization (scale + recenter) never touches the
  // root's authoritative world position.
  const wrap = new TransformNode('rocketCenterpieceWrap', scene);
  wrap.parent = root;
  wrap.rotation.y = ROCKET_YAW;

  // Async load — fire-and-forget, same pattern as buildGlbBuilding. The
  // centerpiece pops in a frame or two after scene init; nothing blocks on it.
  SceneLoader.LoadAssetContainerAsync('/assets/models/environment/', 'rocket.glb', scene)
    .then((container) => {
      container.addAllToScene();
      for (const node of container.rootNodes) node.parent = wrap;
      // Landmark, not interactive — let clicks fall through to the ground tile.
      for (const m of container.meshes) m.isPickable = false;

      // Normalize to ROCKET_TARGET_HEIGHT, base on the ground, centered on
      // `position`. getHierarchyBoundingVectors returns WORLD-space extents;
      // since this is a pure scale-then-translate, one measurement each suffices.
      const pre = wrap.getHierarchyBoundingVectors(true);
      const rawHeight = pre.max.y - pre.min.y;
      if (rawHeight > 0.001) {
        wrap.scaling.setAll(ROCKET_TARGET_HEIGHT / rawHeight);
      }
      const post = wrap.getHierarchyBoundingVectors(true);
      // Shift so base sits at position.y and the footprint centers on position.x/z.
      wrap.position.x += position.x - (post.min.x + post.max.x) / 2;
      wrap.position.y += position.y - post.min.y;
      wrap.position.z += position.z - (post.min.z + post.max.z) / 2;
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[rocket] failed to load rocket.glb:', err);
    });

  return root;
}
