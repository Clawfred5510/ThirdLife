/**
 * characters/glb.ts — loader for the rigged character/agent GLBs.
 *
 * Players load male.glb / female.glb; AI agents load one of the droid variants
 * (droidFood/droidMaterials/droidElectric/droidLux) or the hatless droid.glb.
 * Each GLB is a skinned mesh on a 42-joint skeleton with AnimationGroups named
 * 'Idle' and 'Walk'. The droid variants additionally carry a second 'Hat' mesh
 * skinned to the same skeleton, so the hat tracks the head.
 *
 * Each avatar gets its OWN import via SceneLoader.ImportMeshAsync so its
 * skeleton + AnimationGroups are correctly self-targeted and animate
 * independently. We deliberately do NOT share one AssetContainer +
 * instantiateModelsToScene: with these rigs the cloned AnimationGroups stayed
 * bound to the source skeleton, so clones rendered frozen in bind pose
 * (T-pose). A fresh import per avatar is the robust path; the .glb file itself
 * is HTTP-cached by the browser, so only the (small) glTF parse repeats. If the
 * on-screen avatar count grows large, revisit with a verified clone path.
 */
import {
  Scene,
  SceneLoader,
  TransformNode,
  AbstractMesh,
  AnimationGroup,
  Skeleton,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

const BASE = '/assets/models/characters/';

export interface CharacterInstance {
  /** Instance root — parent this under the avatar's model wrap. */
  root: TransformNode;
  /** Renderable skinned meshes (shadow casters + pick targets). */
  meshes: AbstractMesh[];
  /** AnimationGroups for THIS instance (Idle / Walk), self-targeted. */
  animationGroups: AnimationGroup[];
  /** Skeleton(s) for THIS instance. */
  skeletons: Skeleton[];
  dispose(): void;
}

/**
 * Import one independently-animatable copy of `file`'s character. The returned
 * root has no parent yet — the caller parents + scales it.
 */
export async function instantiateCharacter(
  scene: Scene,
  file: string,
  instanceId: string,
): Promise<CharacterInstance> {
  const result = await SceneLoader.ImportMeshAsync('', BASE, file, scene);

  const root = new TransformNode(`charRoot_${instanceId}`, scene);
  // Re-parent the import's top-level nodes (the glTF __root__ + any siblings)
  // under our own root so the avatar owns the whole subtree.
  for (const n of [...result.transformNodes, ...result.meshes]) {
    if (!n.parent) n.parent = root;
  }

  const meshes = result.meshes.filter(
    (m) => typeof m.getTotalVertices === 'function' && m.getTotalVertices() > 0,
  );

  return {
    root,
    meshes,
    animationGroups: result.animationGroups,
    skeletons: result.skeletons,
    dispose() {
      for (const g of result.animationGroups) g.dispose();
      for (const s of result.skeletons) s.dispose();
      root.dispose(false, true); // disposes the re-parented meshes + nodes
    },
  };
}
