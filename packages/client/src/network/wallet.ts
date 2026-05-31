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

export interface Eip1193Provider {
  request<T = unknown>(args: { method: string; params?: unknown[] }): Promise<T>;
}

// ── EIP-6963: Multi Injected Provider Discovery ──────────────────────────
// Detect EVERY installed EVM wallet (MetaMask, Coinbase/Base, Phantom-EVM,
// Backpack, Rabby, Brave, …) instead of fighting over the single
// window.ethereum slot. That single-slot race is why connection failed on
// some setups: when several wallets are installed they overwrite each other
// in window.ethereum, and any wallet that didn't win (or only announces via
// EIP-6963) looked like "no wallet detected."
interface EIP6963ProviderInfo { uuid: string; name: string; icon: string; rdns: string }
interface EIP6963ProviderDetail { info: EIP6963ProviderInfo; provider: Eip1193Provider }

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
  interface WindowEventMap {
    'eip6963:announceProvider': CustomEvent<EIP6963ProviderDetail>;
  }
}

/** Discovered wallets keyed by rdns (stable per wallet) so re-announcements dedupe. */
const discovered = new Map<string, EIP6963ProviderDetail>();

if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (e) => {
    const detail = e.detail;
    if (detail?.info?.rdns && detail.provider) discovered.set(detail.info.rdns, detail);
  });
  // Ask any already-loaded wallets to announce themselves.
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

/** Re-ask wallets to announce — call right before showing the picker so
 *  late-loading extensions still appear. */
export function refreshWallets(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('eip6963:requestProvider'));
}

export interface WalletOption {
  id: string;     // rdns, or 'injected' for the window.ethereum fallback
  name: string;
  icon: string;   // data-URI icon from the wallet ('' for the fallback)
  provider: Eip1193Provider;
}

/** Every detected EVM wallet (EIP-6963), branded-major-first then alphabetical.
 *  Falls back to a single window.ethereum entry when no wallet implements
 *  EIP-6963 (older single-wallet setups), so nothing regresses. */
export function listWallets(): WalletOption[] {
  const out: WalletOption[] = [];
  for (const d of discovered.values()) {
    out.push({ id: d.info.rdns, name: d.info.name, icon: d.info.icon, provider: d.provider });
  }
  if (out.length === 0 && typeof window !== 'undefined' && window.ethereum) {
    out.push({ id: 'injected', name: 'Browser Wallet', icon: '', provider: window.ethereum });
  }
  const ORDER = ['com.coinbase.wallet', 'io.metamask', 'app.phantom', 'com.backpack', 'io.rabby'];
  out.sort((a, b) => {
    const ai = ORDER.indexOf(a.id), bi = ORDER.indexOf(b.id);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.name.localeCompare(b.name);
  });
  return out;
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
  return typeof window !== 'undefined' && (discovered.size > 0 || !!window.ethereum);
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
export async function connectWallet(provider?: Eip1193Provider): Promise<ConnectResult> {
  // Resolve which wallet to use: the explicitly chosen one (from the picker),
  // else the sole detected wallet, else window.ethereum (legacy single-wallet).
  let wallet = provider;
  if (!wallet) {
    const wallets = listWallets();
    if (wallets.length === 1) wallet = wallets[0].provider;
    else if (typeof window !== 'undefined' && window.ethereum) wallet = window.ethereum;
  }
  if (!wallet) {
    throw new Error('No wallet detected. Install an EVM wallet — MetaMask, Coinbase/Base, Phantom, Backpack, or Rabby.');
  }
  const accounts = await wallet.request<string[]>({ method: 'eth_requestAccounts' });
  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts returned from wallet.');
  }
  const rawAddress = accounts[0];

  const base = resolveAuthBaseUrl();
  const challengeRes = await fetch(`${base}/api/v1/auth/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: rawAddress }),
  });
  if (!challengeRes.ok) {
    const t = await challengeRes.text();
    throw new Error(`Challenge failed: ${challengeRes.status} ${t}`);
  }
  // Server returns the EIP-55 checksummed address — use it for personal_sign
  // so MetaMask's EIP-4361 validation matches (address inside the SIWE
  // message must be checksummed; the `from` param to personal_sign must
  // match it case-sensitively in recent MetaMask versions).
  const { message, address: checksummedAddress } = await challengeRes.json() as {
    message: string;
    address: string;
  };
  const address = checksummedAddress ?? rawAddress;

  const signature = await wallet.request<string>({
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
