/**
 * Small REST helper for game-server endpoints (/api/v1/...).
 * Mirrors the base-URL resolution in wallet.ts.
 *
 * Auth: the helpers automatically attach the stored wallet session token
 * (from localStorage, populated by wallet.connectWallet) as Bearer when
 * `authed = true` is passed. Endpoints that don't require auth can call
 * the plain forms.
 *
 * After the 2026-05-16 identity rework, the same wallet token is what
 * the Phone UI uses to drive every market/agent endpoint — agents and
 * humans hit identical routes, just with different issuers.
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

const TOKEN_KEY = 'tl_auth_token';

function authHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    return token ? { authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
}

export async function apiGet<T>(path: string, opts?: { authed?: boolean }): Promise<T> {
  const headers: Record<string, string> = opts?.authed ? authHeaders() : {};
  const r = await fetch(`${API_BASE}/api/v1${path}`, { headers });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return (await r.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown, opts?: { authed?: boolean }): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts?.authed) Object.assign(headers, authHeaders());
  const r = await fetch(`${API_BASE}/api/v1${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
  if (!r.ok) {
    let detail = '';
    try { detail = (await r.text()).slice(0, 200); } catch { /* ignore */ }
    throw new Error(`POST ${path} → ${r.status}${detail ? ': ' + detail : ''}`);
  }
  return (await r.json()) as T;
}

export async function apiDelete<T>(path: string, opts?: { authed?: boolean }): Promise<T> {
  const headers: Record<string, string> = opts?.authed ? authHeaders() : {};
  const r = await fetch(`${API_BASE}/api/v1${path}`, { method: 'DELETE', headers });
  if (!r.ok) throw new Error(`DELETE ${path} → ${r.status}`);
  return (await r.json()) as T;
}

export function hasAuthToken(): boolean {
  try { return !!localStorage.getItem(TOKEN_KEY); } catch { return false; }
}
