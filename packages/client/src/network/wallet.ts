// Web3 wallet authentication. Uses the EIP-1193 provider injected by
// MetaMask / Rabby / Brave Wallet (window.ethereum). No external dep on the
// client — server side does the signature verification with viem.
//
// Flow:
//   1. eth_requestAccounts → user-approved address
//   2. POST /api/v1/auth/challenge { address } → SIWE-style message + nonce
//   3. personal_sign(message, address) → signature
//   4. POST /api/v1/auth/verify { address, message, signature } → token + playerId
//   5. Persist token + playerId in localStorage so subsequent connects bind
//      to the wallet identity.

interface Eip1193Provider {
  request<T = unknown>(args: { method: string; params?: unknown[] }): Promise<T>;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const TOKEN_KEY = 'tl_auth_token';
const PLAYER_ID_KEY = 'tl_player_id';

function resolveAuthBaseUrl(): string {
  // Prefer explicit env var; otherwise derive from the configured Colyseus
  // server URL (ws/wss → http/https). Same-host fallback last.
  const w = window as unknown as { __GAME_SERVER_URL__?: string };
  if (w.__GAME_SERVER_URL__) return wsToHttp(w.__GAME_SERVER_URL__);
  const viteUrl = (import.meta as unknown as { env?: { VITE_SERVER_URL?: string } }).env?.VITE_SERVER_URL;
  if (viteUrl) return wsToHttp(viteUrl);
  return `${window.location.protocol}//${window.location.host}`;
}

function wsToHttp(url: string): string {
  return url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

export function hasInjectedWallet(): boolean {
  return typeof window !== 'undefined' && !!window.ethereum;
}

export function getStoredAuthToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function getStoredPlayerId(): string | null {
  try { return localStorage.getItem(PLAYER_ID_KEY); } catch { return null; }
}

export function clearWalletAuth(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PLAYER_ID_KEY);
  } catch { /* ignore */ }
}

export interface ConnectResult {
  address: string;
  token: string;
  expiresAt: number;
}

/**
 * Run the full connect flow: request account, fetch challenge, sign, exchange
 * for a session token. Throws with a user-friendly message on failure
 * (rejected popup, no provider, server error, etc.).
 */
export async function connectWallet(): Promise<ConnectResult> {
  if (!window.ethereum) {
    throw new Error('No wallet detected. Install MetaMask or another EIP-1193 wallet.');
  }
  const accounts = await window.ethereum.request<string[]>({ method: 'eth_requestAccounts' });
  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts returned from wallet.');
  }
  const address = accounts[0];

  const base = resolveAuthBaseUrl();
  const challengeRes = await fetch(`${base}/api/v1/auth/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  if (!challengeRes.ok) {
    const t = await challengeRes.text();
    throw new Error(`Challenge failed: ${challengeRes.status} ${t}`);
  }
  const { message } = await challengeRes.json() as { message: string };

  const signature = await window.ethereum.request<string>({
    method: 'personal_sign',
    params: [message, address],
  });

  const verifyRes = await fetch(`${base}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address, message, signature }),
  });
  if (!verifyRes.ok) {
    const t = await verifyRes.text();
    throw new Error(`Verify failed: ${verifyRes.status} ${t}`);
  }
  const { token, playerId, expiresAt } = await verifyRes.json() as { token: string; playerId: string; expiresAt: number };

  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(PLAYER_ID_KEY, playerId);
  } catch { /* ignore — caller will see token via getStoredAuthToken */ }

  return { address: playerId, token, expiresAt };
}

export async function logoutWallet(): Promise<void> {
  const token = getStoredAuthToken();
  clearWalletAuth();
  if (!token) return;
  try {
    const base = resolveAuthBaseUrl();
    await fetch(`${base}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    });
  } catch { /* server-side revoke is best-effort */ }
}
