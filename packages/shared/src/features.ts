/**
 * Feature-flag system for ThirdLife.
 *
 * Provides default flag values. Callers (client, server) can override via
 * `initFeatures()` to inject values from their own environment sources
 * (e.g. `import.meta.env.VITE_FEATURE_*` on the client, `process.env.FEATURE_*`
 * on the server).
 */

/** All recognised feature-flag keys. */
export interface FeatureFlags {
  /** Job system (job board, objectives, rewards). Default: false. */
  JOBS: boolean;
  /** NPC spawning and AI. Default: false. */
  NPCS: boolean;
  /** Tutorial overlay for new players. Default: false. */
  TUTORIAL: boolean;
  /** Day/night sky cycle. Default: true. */
  DAY_NIGHT: boolean;
}

// --- Defaults ----------------------------------------------------------------

const DEFAULTS: FeatureFlags = {
  JOBS: false,
  NPCS: false,
  TUTORIAL: false,
  DAY_NIGHT: true,
};

/** Mutable overrides — initially empty so defaults are used. */
let overrides: Partial<FeatureFlags> = {};

// --- Public API --------------------------------------------------------------

/**
 * Apply feature-flag overrides.  Pass only the keys you want to change;
 * any omitted key keeps its default value.
 */
export function initFeatures(partial: Partial<FeatureFlags>): void {
  overrides = { ...partial };
}

/**
 * Read the current value of a feature flag.
 *
 * Resolution order: override → default.
 */
export function isFeatureOn<K extends keyof FeatureFlags>(key: K): boolean {
  if (key in overrides) {
    return !!overrides[key];
  }
  return !!DEFAULTS[key];
}

/** Convenient object-access form: `features.JOBS`, `features.NPCS`, … */
export const features = {
  get JOBS(): boolean { return isFeatureOn('JOBS'); },
  get NPCS(): boolean { return isFeatureOn('NPCS'); },
  get TUTORIAL(): boolean { return isFeatureOn('TUTORIAL'); },
  get DAY_NIGHT(): boolean { return isFeatureOn('DAY_NIGHT'); },
} as const;

/** Convenience type for the feature map keys. */
export type FeatureKey = keyof FeatureFlags;
