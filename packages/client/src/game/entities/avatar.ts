/**
 * avatar.ts — GLB-backed character renderer.
 *
 * Replaces the old 100%-procedural capsule avatar (2026-06-01). Players render
 * as a rigged male.glb / female.glb (chosen at account creation, see
 * Appearance.character); AI agents render as a droid variant chosen by their
 * workplace building category (droidFood/Materials/Electric/Lux) or the hatless
 * droid.glb. Every model is a skinned mesh on a shared 42-joint rig with
 * AnimationGroups 'Idle' and 'Walk'.
 *
 * Contract preserved for MainScene + CharacterCreator: the same four free
 * functions (buildAvatar / applyAppearance / animateAvatar / disposeAvatar) and
 * an `Avatar` with a `root` TransformNode + a `body` anchor mesh. Because GLB
 * loading is async but buildAvatar must return synchronously, the avatar hands
 * back `root` + an invisible `body` anchor immediately and streams the model in;
 * callers wire shadow casters internally (shadowGenerator passed in opts) and
 * pick targets via `onReady(meshes => …)` (re-fired on every model swap).
 */
import {
  Scene,
  TransformNode,
  Mesh,
  MeshBuilder,
  AbstractMesh,
  AnimationGroup,
  ShadowGenerator,
} from '@babylonjs/core';
import type { Appearance, BuildingCategory } from '@gamestu/shared';
import { AVATAR_WALK_SPEED_THRESHOLD } from '@gamestu/shared';
import { instantiateCharacter, CharacterInstance } from './characters/glb';

/** World-space target height (feet at y=0). The procedural avatar stood ~1.95;
 *  the GLBs author at ~2.05, so we normalize for a consistent camera/nameplate
 *  feel and to match the local collider (~2u). Tune here. */
const TARGET_HEIGHT = 1.9;

/** Static yaw to align the GLB's authored facing with the game's "forward"
 *  (root.rotation.y = camera-derived yaw; the player faces +Z toward the rocket
 *  on spawn, i.e. back to the spawn camera — matching the old procedural
 *  avatar). The Synty rig reads facing the spawn camera at offset 0, so we flip
 *  Math.PI to turn its back to the camera like before. NOTE: confirm in a real
 *  browser (headless can't render the walk cycle); flip to 0 if avatars face
 *  backwards. */
const CHARACTER_YAW_OFFSET = Math.PI;

export interface AvatarOptions {
  /** Set for AI agents — drives droid-vs-human model choice. */
  botKind?: 'auto' | 'agent' | 'external';
  /** AI agents only — workplace category selects the droid hat variant. */
  botCategory?: BuildingCategory;
  /** Sun shadow generator; the avatar registers/deregisters its own meshes
   *  as casters across model loads/swaps so we never leak disposed casters. */
  shadowGenerator?: ShadowGenerator | null;
}

/** Resolve which GLB file an avatar should load. Agents (bot_kind set) use the
 *  droid variant for their workplace category; everyone else is a human male/
 *  female by Appearance.character (undefined → male fallback). */
function modelFileFor(appearance: Appearance, opts?: AvatarOptions): string {
  if (opts?.botKind) {
    switch (opts.botCategory) {
      case 'food':            return 'droidFood.glb';
      case 'materials':       return 'droidMaterials.glb';
      case 'energy':          return 'droidElectric.glb';
      case 'luxury-housing':
      case 'luxury-civic':    return 'droidLux.glb';
      default:                return 'droid.glb';
    }
  }
  return appearance.character === 'female' ? 'female.glb' : 'male.glb';
}

export class Avatar {
  /** Positioned + rotated by MainScene every frame. */
  readonly root: TransformNode;
  /** Invisible torso-height anchor for the nameplate/badge/camera links. Stable
   *  across model loads (the GLB streams in under `modelWrap`). */
  readonly body: Mesh;

  private readonly scene: Scene;
  private readonly id: string;
  private readonly modelWrap: TransformNode;
  private readonly shadowGenerator: ShadowGenerator | null;

  private currentFile: string | null = null;
  private instance: CharacterInstance | null = null;
  private idle: AnimationGroup | null = null;
  private walk: AnimationGroup | null = null;
  private state: 'idle' | 'walk' | null = null;
  /** Persistent ready callbacks (pick-wiring). Re-fired on every model load. */
  private readyCbs: Array<(meshes: AbstractMesh[]) => void> = [];
  /** Monotonic token so a slow load that resolves after a newer swap is dropped. */
  private loadToken = 0;
  private disposed = false;

  constructor(scene: Scene, id: string, appearance: Appearance, opts?: AvatarOptions) {
    this.scene = scene;
    this.id = id;
    this.shadowGenerator = opts?.shadowGenerator ?? null;

    this.root = new TransformNode(`avatar_${id}`, scene);
    this.modelWrap = new TransformNode(`avatarModel_${id}`, scene);
    this.modelWrap.parent = this.root;
    this.modelWrap.rotation.y = CHARACTER_YAW_OFFSET;

    this.body = MeshBuilder.CreateBox(`avatarAnchor_${id}`, { size: 0.12 }, scene);
    this.body.parent = this.root;
    this.body.position.y = 1.1;
    this.body.isVisible = false;
    this.body.isPickable = false;

    void this.load(modelFileFor(appearance, opts));
  }

  /** Register a callback fired with the renderable meshes once the model is
   *  ready — and again after any model swap (so pick targets re-bind). Fires
   *  immediately if the model is already loaded. */
  onReady(cb: (meshes: AbstractMesh[]) => void): void {
    this.readyCbs.push(cb);
    if (this.instance && !this.disposed) cb(this.instance.meshes);
  }

  /** Reload the model if the resolved file changed (character pick, or a bot's
   *  workplace category changed). GLBs carry embedded PBR, so per-slot color
   *  customization no longer applies — only the model identity matters. */
  applyState(appearance: Appearance, opts?: AvatarOptions): void {
    const file = modelFileFor(appearance, opts);
    if (file !== this.currentFile) void this.load(file);
  }

  /** Drive Idle ↔ Walk from instantaneous horizontal speed (units/s). */
  animate(velocity: number, _dt: number, _time: number): void {
    if (!this.instance) return;
    const walking = velocity > AVATAR_WALK_SPEED_THRESHOLD;
    if (walking && this.state !== 'walk') this.play('walk');
    else if (!walking && this.state !== 'idle') this.play('idle');
  }

  dispose(): void {
    this.disposed = true;
    this.removeCasters();
    this.instance?.dispose();
    this.instance = null;
    this.body.dispose();
    this.root.dispose(false, true);
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async load(file: string): Promise<void> {
    this.currentFile = file;
    const token = ++this.loadToken;
    let inst: CharacterInstance;
    try {
      inst = await instantiateCharacter(this.scene, file, `${this.id}_${token}`);
    } catch (err) {
      console.warn(`[avatar] failed to load ${file}:`, err);
      return;
    }
    // A newer load started, or we were disposed, while this awaited — drop it.
    if (this.disposed || token !== this.loadToken) { inst.dispose(); return; }

    // Swap out any previous model (character pick / bot-category change).
    if (this.instance) { this.removeCasters(); this.instance.dispose(); this.instance = null; }

    inst.root.parent = this.modelWrap;
    this.normalizeHeight();
    this.instance = inst;

    this.idle = inst.animationGroups.find((g) => /idle/i.test(g.name)) ?? null;
    this.walk = inst.animationGroups.find((g) => /walk/i.test(g.name)) ?? null;
    for (const g of inst.animationGroups) g.stop();
    this.state = null;
    this.play('idle');

    // Skinned meshes cast shadows; register the new set.
    if (this.shadowGenerator) {
      for (const m of inst.meshes) this.shadowGenerator.addShadowCaster(m);
    }
    // Re-fire ready callbacks (pick-target wiring) with the fresh meshes.
    for (const cb of this.readyCbs) cb(inst.meshes);
  }

  private removeCasters(): void {
    if (!this.shadowGenerator || !this.instance) return;
    for (const m of this.instance.meshes) this.shadowGenerator.removeShadowCaster(m);
  }

  /** Scale modelWrap so the model is TARGET_HEIGHT tall with feet at root.y(=0).
   *  Mirrors the rocket-centerpiece normalize: measure → scale → re-measure →
   *  shift so the bounding-box floor rests on the ground. */
  private normalizeHeight(): void {
    const pre = this.modelWrap.getHierarchyBoundingVectors(true);
    const rawH = pre.max.y - pre.min.y;
    if (rawH > 0.001) this.modelWrap.scaling.setAll(TARGET_HEIGHT / rawH);
    const post = this.modelWrap.getHierarchyBoundingVectors(true);
    // root sits at world y=0; drop the model so its feet rest there.
    this.modelWrap.position.y += this.root.getAbsolutePosition().y - post.min.y;
  }

  private play(which: 'idle' | 'walk'): void {
    const g = which === 'walk' ? this.walk : this.idle;
    const other = which === 'walk' ? this.idle : this.walk;
    other?.stop();
    if (g) g.start(true, 1.0, g.from, g.to);
    this.state = which;
  }
}

// ── Back-compat free-function surface (MainScene + CharacterCreator import) ──

export function buildAvatar(
  scene: Scene,
  id: string,
  appearance: Appearance,
  opts?: AvatarOptions,
): Avatar {
  return new Avatar(scene, id, appearance, opts);
}

export function applyAppearance(
  _scene: Scene,
  avatar: Avatar,
  appearance: Appearance,
  opts?: AvatarOptions,
): void {
  avatar.applyState(appearance, opts);
}

export function animateAvatar(avatar: Avatar, velocity: number, dt: number, time: number): void {
  avatar.animate(velocity, dt, time);
}

export function disposeAvatar(avatar: Avatar): void {
  avatar.dispose();
}
