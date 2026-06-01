/**
 * Cache-busting version for static GLB assets served from public/assets/.
 *
 * Vite fingerprints JS/CSS, but files under public/ keep fixed paths
 * (e.g. /assets/models/characters/male.glb), so when we re-export a GLB with
 * the SAME filename, browsers (and the Vercel CDN) serve the previously-cached
 * copy — players see the old model. Appending `?v=ASSET_VERSION` to GLB URLs
 * changes the cache key so updated assets actually load.
 *
 * BUMP THIS whenever a GLB under public/assets/models/ is re-exported/re-synced.
 */
export const ASSET_VERSION = '20260601a';

/** Append the cache-busting query to a GLB filename/path. */
export function vGlb(file: string): string {
  return `${file}?v=${ASSET_VERSION}`;
}
