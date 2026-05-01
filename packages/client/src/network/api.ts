/**
 * Small REST helper for game-server endpoints (/api/v1/...).
 * Mirrors the base-URL resolution in wallet.ts but handles the public
 * (no-auth) endpoints used by the in-game UI.
 *
 * Auth-bearing endpoints take a token in the Authorization header.
 */

function wsToHttp(url: string): string {
  return url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

function resolveApiBase(): string {
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __GAME_SERVER_URL__?: string };
    if (w.__GAME_SERVER_URL__) return wsToHttp(w.__GAME_SERVER_URL__);
  }
  const viteUrl = (import.meta as unknown as { env?: { VITE_SERVER_URL?: string } }).env?.VITE_SERVER_URL;
  if (viteUrl) return wsToHttp(viteUrl);
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.host}`;
  }
  return 'http://localhost:2567';
}

export const API_BASE = resolveApiBase();

export async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}/api/v1${path}`);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return (await r.json()) as T;
}
