/**
 * site-gate.ts — username/password access gate for the whole web client.
 *
 * Purpose: while ThirdLife is in private testing we don't want the live URL to
 * be openable by anyone who stumbles onto it. This is a SHARED credential gate
 * (one username + one password for all testers), validated SERVER-SIDE so the
 * password never ships in the client bundle (a client-only check would be
 * readable by anyone who opens devtools).
 *
 * This is access control for the test build, NOT per-user identity — wallet
 * SIWE auth (api/auth.ts) remains the real gameplay identity boundary.
 *
 * Flow:
 *   GET  /api/v1/site-gate/status            → { enabled }  (client asks whether to show the gate)
 *   POST /api/v1/site-gate/login {user,pass} → { token, expiresAt } | 401
 *   POST /api/v1/site-gate/verify {token}    → { ok: true } | 401   (re-checked every page load)
 *
 * Enabling: set SITE_GATE_USER + SITE_GATE_PASSWORD in the server env. If
 * SITE_GATE_PASSWORD is unset the gate is DISABLED (status.enabled=false) and
 * the client skips straight to the game — so a fresh/local deploy is never
 * accidentally locked out. Optional: SITE_GATE_SECRET (HMAC key; derived from
 * the password if unset) and SITE_GATE_TTL_DAYS (default 7).
 *
 * Token format: base64url(JSON payload) + '.' + hex HMAC-SHA256(payload).
 * Stateless (no DB) — the gate is a coarse shared lock, not a session store.
 */
import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';

const router = Router();

const GATE_USER = process.env.SITE_GATE_USER || '';
const GATE_PASSWORD = process.env.SITE_GATE_PASSWORD || '';
const GATE_ENABLED = GATE_PASSWORD.length > 0;
const TTL_MS = (() => {
  const days = Number(process.env.SITE_GATE_TTL_DAYS);
  return (Number.isFinite(days) && days > 0 ? days : 7) * 24 * 60 * 60 * 1000;
})();
// HMAC key: explicit SITE_GATE_SECRET, else derived from the password so the
// owner only has to set USER + PASSWORD. Derivation is stable across restarts
// (same password → same key) so issued tokens survive a redeploy.
const GATE_SECRET = process.env.SITE_GATE_SECRET
  || crypto.createHash('sha256').update(`thirdlife-site-gate:${GATE_PASSWORD}`).digest('hex');

/** Constant-time string compare that won't early-exit on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch; hash both to fixed length first
  // so the comparison itself is constant-time regardless of input lengths.
  const ah = crypto.createHash('sha256').update(ab).digest();
  const bh = crypto.createHash('sha256').update(bb).digest();
  return crypto.timingSafeEqual(ah, bh);
}

function sign(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = crypto.createHmac('sha256', GATE_SECRET).update(body).digest('hex');
  return `${body}.${mac}`;
}

function verifyToken(token: unknown): boolean {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const dot = token.lastIndexOf('.');
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', GATE_SECRET).update(body).digest('hex');
  // timing-safe HMAC compare (equal length hex strings).
  if (mac.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(mac, 'utf8'), Buffer.from(expected, 'utf8'))) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { exp?: number };
    return typeof payload.exp === 'number' && payload.exp > Date.now();
  } catch {
    return false;
  }
}

// ── Brute-force throttle: per-IP failed-attempt counter with a sliding window.
// Coarse and in-memory (single Railway instance) — enough to stop password
// guessing without a dependency. Successful logins reset the counter.
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const attempts = new Map<string, { count: number; resetAt: number }>();

function throttled(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now > rec.resetAt) return false;
  return rec.count >= MAX_ATTEMPTS;
}
function recordFailure(ip: string): void {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now > rec.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    rec.count += 1;
  }
}

router.get('/status', (_req: Request, res: Response) => {
  return res.json({ enabled: GATE_ENABLED });
});

router.post('/login', (req: Request, res: Response) => {
  if (!GATE_ENABLED) {
    // Gate disabled — issue a token anyway so the client flow is uniform.
    return res.json({ token: sign({ exp: Date.now() + TTL_MS }), expiresAt: Date.now() + TTL_MS });
  }
  const ip = (req.ip || req.socket.remoteAddress || 'unknown').toString();
  if (throttled(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Wait a few minutes and try again.' });
  }
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Missing username or password' });
  }
  // Evaluate both comparisons regardless so timing doesn't leak which field
  // was wrong.
  const userOk = safeEqual(username, GATE_USER);
  const passOk = safeEqual(password, GATE_PASSWORD);
  if (!userOk || !passOk) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  attempts.delete(ip);
  const expiresAt = Date.now() + TTL_MS;
  return res.json({ token: sign({ exp: expiresAt }), expiresAt });
});

router.post('/verify', (req: Request, res: Response) => {
  if (!GATE_ENABLED) return res.json({ ok: true });
  const { token } = req.body ?? {};
  if (verifyToken(token)) return res.json({ ok: true });
  return res.status(401).json({ ok: false });
});

export default router;
