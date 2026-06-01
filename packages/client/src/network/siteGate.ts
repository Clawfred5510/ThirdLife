// Client side of the username/password site gate (server: api/site-gate.ts).
// While ThirdLife is in private testing the whole web client sits behind a
// shared credential. The password is validated SERVER-SIDE — this module only
// stores/relays the opaque gate token and asks the server whether the gate is
// even enabled.

import { resolveAuthBaseUrl } from './wallet';

const GATE_TOKEN_KEY = 'tl_site_gate_token';

export function getStoredGateToken(): string | null {
  try { return localStorage.getItem(GATE_TOKEN_KEY); } catch { return null; }
}

function storeGateToken(token: string): void {
  try { localStorage.setItem(GATE_TOKEN_KEY, token); } catch { /* private mode — gate just re-prompts next load */ }
}

export function clearGateToken(): void {
  try { localStorage.removeItem(GATE_TOKEN_KEY); } catch { /* ignore */ }
}

/** Is the site gate switched on in this deployment? (Off ⇒ skip the login
 *  screen entirely.) Network error ⇒ assume OFF so a server hiccup never hard-
 *  locks testers out of the client. */
export async function getGateStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${resolveAuthBaseUrl()}/api/v1/site-gate/status`);
    if (!res.ok) return false;
    const { enabled } = await res.json() as { enabled: boolean };
    return !!enabled;
  } catch {
    return false;
  }
}

/** Re-check the stored gate token against the server (called on every load so
 *  a forged localStorage flag can't bypass the gate — the HMAC is server-only). */
export async function verifyGate(): Promise<boolean> {
  const token = getStoredGateToken();
  if (!token) return false;
  try {
    const res = await fetch(`${resolveAuthBaseUrl()}/api/v1/site-gate/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return false;
    const { ok } = await res.json() as { ok: boolean };
    return !!ok;
  } catch {
    return false;
  }
}

/** Exchange username+password for a gate token. Throws with a user-facing
 *  message on bad credentials / rate-limit / network error. */
export async function loginGate(username: string, password: string): Promise<void> {
  const res = await fetch(`${resolveAuthBaseUrl()}/api/v1/site-gate/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    let msg = `Login failed (${res.status})`;
    try { const j = await res.json() as { error?: string }; if (j.error) msg = j.error; } catch { /* keep default */ }
    throw new Error(msg);
  }
  const { token } = await res.json() as { token: string };
  storeGateToken(token);
}
