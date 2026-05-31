/**
 * HTTP-layer verification — wallet-gated registration, auth-failure logging,
 * and rate limiting.
 *
 * Rewritten 2026-05-31 for current reality:
 *   - /agents/register is now WALLET-GATED (needs a Bearer wallet session
 *     token) and costs IN_GAME_AGENT_COST_AMETA; it no longer returns the
 *     api_key inline (export it via GET /agents/:id/api-key).
 *   - logAuthFailure no longer PERSISTS the client IP / UA / key-hint into the
 *     (unauthenticated) events table — that was a PII leak fixed in the
 *     2026-05-31 security pass. The persisted event keeps only path + reason;
 *     the raw IP/UA/hint go to the server console only.
 *
 * Uses dynamic require AFTER setting env vars (ESM imports hoist).
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import * as crypto from 'crypto';
import express from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-http-'));
process.env.DATABASE_PATH = path.join(tmp, 'test.db');
delete process.env.TEST_BALANCE;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const agentApi = require('../api/agent-api').default as express.Router;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const db = require('../db') as typeof import('../db');
const { getEvents, seedParcels, getOrCreatePlayer, updatePlayerCredits, createAuthSession } = db;

seedParcels();

const app = express();
app.use(express.json());
app.use('/api/v1', agentApi);

const server = http.createServer(app);
const PORT = 0;

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

server.listen(PORT, '127.0.0.1', async () => {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}/api/v1`;

  // ── Set up a funded wallet + a real session token ──────────────────────
  // Registration is wallet-gated and costs $AMETA; mint a session token
  // directly (the SIWE /verify flow is covered by the live wallet test) and
  // fund the wallet so it can afford the 200K agent purchase fee.
  const wallet = '0x' + 'a'.repeat(40);
  getOrCreatePlayer(wallet, 'RateTesterWallet');
  updatePlayerCredits(wallet, 1_000_000);
  const sessionToken = 'testsess_' + crypto.randomBytes(16).toString('hex');
  createAuthSession(sessionToken, wallet, Date.now() + 3_600_000);
  const walletHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` };

  // ── Registration is wallet-gated ───────────────────────────────────────
  const noAuthReg = await fetch(`${base}/agents/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'NoAuthAgent', role: 'work' }),
  });
  check('register without a wallet token is rejected (401)', noAuthReg.status === 401);

  const regRes = await fetch(`${base}/agents/register`, {
    method: 'POST',
    headers: walletHeaders,
    body: JSON.stringify({ name: 'RateTester', role: 'work' }),
  });
  const reg = await regRes.json();
  check('wallet-authed registration succeeds', regRes.status === 200 && reg?.agent?.id,
    `status=${regRes.status} body=${JSON.stringify(reg).slice(0, 160)}`);
  // In-game registration does NOT return the api_key inline — export it.
  const agentId: string = reg?.agent?.id;
  const keyRes = await fetch(`${base}/agents/${encodeURIComponent(agentId)}/api-key`, { headers: walletHeaders });
  const keyJson = await keyRes.json();
  const apiKey: string = keyJson?.api_key;
  check('owner can export the agent api_key (tl_sk_)', typeof apiKey === 'string' && apiKey.startsWith('tl_sk_'),
    `body=${JSON.stringify(keyJson).slice(0, 120)}`);

  // ── auth-failure logging (path + reason persisted; IP/key NOT) ──────────
  console.log('\n[auth failure logging]');
  const eventsBefore = getEvents(500).filter(e => e.type === 'auth_failure').length;

  const r1 = await fetch(`${base}/actions/work`, { method: 'POST' });
  check('401 when no auth header', r1.status === 401);

  const r2 = await fetch(`${base}/actions/work`, {
    method: 'POST',
    headers: { Authorization: 'Bearer tl_sk_bogus_key_for_test_only_abc123' },
  });
  check('401 when invalid key', r2.status === 401);

  const eventsAfter = getEvents(500).filter(e => e.type === 'auth_failure').length;
  check('auth_failure events logged (2 new)', eventsAfter - eventsBefore === 2,
    `before=${eventsBefore} after=${eventsAfter}`);

  const latest = getEvents(5).find(e => e.type === 'auth_failure');
  const payload = latest ? JSON.parse(latest.data) : {};
  check('auth_failure event records path + reason', !!payload.path && !!payload.reason);
  // Security fix 2026-05-31: raw IP / UA / API-key hint must NOT be persisted
  // to the unauthenticated events table (they go to the server console only).
  check('auth_failure event does NOT persist client IP (PII)', payload.ip === undefined);
  check('auth_failure event does NOT persist the API-key hint', payload.key_hint === undefined);

  // ── rate limiting ──────────────────────────────────────────────────────
  // Blast a rate-limited mutating endpoint (/actions/buy-land — authed by the
  // wallet session token + the shared rateLimit middleware). The handler may
  // reject the buy (bad parcel) AFTER the limiter runs, so what we assert is
  // purely the limiter: the first request is not throttled, and a flood is
  // eventually rejected with 429.
  void apiKey; // (exported above to prove the owner-only key export works)
  let firstStatus = 0;
  let firstRejectStatus = 0;
  const firstRejectBody: { error?: string } = {};
  for (let i = 0; i < 80; i++) {
    const r = await fetch(`${base}/actions/buy-land`, {
      method: 'POST', headers: walletHeaders, body: JSON.stringify({ parcelId: 999999 }),
    });
    if (i === 0) firstStatus = r.status;
    if (r.status === 429) {
      firstRejectStatus = 429;
      Object.assign(firstRejectBody, await r.json());
      break;
    }
  }
  check('first request is not rate-limited', firstStatus !== 0 && firstStatus !== 429, `firstStatus=${firstStatus}`);
  check('rate limiter returns 429 after burst', firstRejectStatus === 429);
  check('429 body has rate-limit error message', typeof firstRejectBody.error === 'string' && /rate/i.test(firstRejectBody.error));

  // ── Cleanup ────────────────────────────────────────────────────────────
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
});
