/**
 * Wallet-gated entry + site password gate (2026-06-01, task #27).
 *
 *   Run with: npx tsx src/__tests__/wallet-gate-2026-06-01.test.ts
 *
 * Verifies:
 *   A) Site gate (api/site-gate.ts): status reports enabled; wrong creds → 401;
 *      correct creds issue a token; the token verifies; a forged token is
 *      rejected (HMAC is server-only).
 *   B) Wallet mandatory (GameRoom.onJoin): a join with NO authToken is rejected
 *      (4003 wallet_required) and a join with a bogus token is rejected (4001
 *      auth_token_invalid). There is no guest path — these early-return before
 *      any room state is touched.
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import express from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-walletgate-'));
process.env.DATABASE_PATH = path.join(tmp, 'test.db');
process.env.SITE_GATE_USER = 'tester';
process.env.SITE_GATE_PASSWORD = 'sekret-123';
delete process.env.TEST_BALANCE;

// Require AFTER env is set — site-gate reads SITE_GATE_* at module load.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const siteGateApi = require('../api/site-gate').default as express.Router;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GameRoom } = require('../rooms/GameRoom') as typeof import('../rooms/GameRoom');

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); fail++; }
}

const app = express();
app.use(express.json());
app.use('/api/v1/site-gate', siteGateApi);
const server = http.createServer(app);

interface RecordedClient {
  sessionId: string;
  error: (code: number, msg?: string) => void;
  leave: (code?: number, msg?: string) => void;
  send: () => void;
  errors: Array<{ code: number; msg?: string }>;
  leaves: Array<{ code?: number; msg?: string }>;
}
function mockClient(sessionId: string): RecordedClient {
  const errors: Array<{ code: number; msg?: string }> = [];
  const leaves: Array<{ code?: number; msg?: string }> = [];
  return {
    sessionId,
    errors,
    leaves,
    error: (code: number, msg?: string) => errors.push({ code, msg }),
    leave: (code?: number, msg?: string) => leaves.push({ code, msg }),
    send: () => { /* not reached on reject path */ },
  };
}

server.listen(0, '127.0.0.1', async () => {
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api/v1/site-gate`;

  async function post(p: string, body: object) {
    const r = await fetch(`${base}${p}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }

  // ── A) Site gate ────────────────────────────────────────────────────
  const status = await (await fetch(`${base}/status`)).json() as { enabled: boolean };
  check('status.enabled is true when SITE_GATE_PASSWORD set', status.enabled === true);

  const wrong = await post('/login', { username: 'tester', password: 'nope' });
  check('login with wrong password → 401', wrong.status === 401);

  const wrongUser = await post('/login', { username: 'nobody', password: 'sekret-123' });
  check('login with wrong username → 401', wrongUser.status === 401);

  const ok = await post('/login', { username: 'tester', password: 'sekret-123' });
  check('login with correct creds → 200 + token', ok.status === 200 && typeof ok.body.token === 'string' && ok.body.token.length > 10);
  const token = ok.body.token as string;

  const verifyOk = await post('/verify', { token });
  check('verify accepts the issued token', verifyOk.status === 200 && verifyOk.body.ok === true);

  const forged = await post('/verify', { token: token.replace(/.$/, (c: string) => (c === 'a' ? 'b' : 'a')) });
  check('verify rejects a tampered token (HMAC mismatch)', forged.status === 401);

  const empty = await post('/verify', { token: '' });
  check('verify rejects an empty token', empty.status === 401);

  // ── B) Wallet mandatory in onJoin ────────────────────────────────────
  const room = new (GameRoom as unknown as { new (): { onJoin: (c: unknown, o: unknown) => void } })();

  const noToken = mockClient('sid-no-token');
  room.onJoin(noToken, { name: 'Guest' }); // no authToken at all
  check('join without authToken is rejected (no guest play)',
    noToken.leaves.some((l) => l.code === 4003 && l.msg === 'wallet_required'),
    `leaves=${JSON.stringify(noToken.leaves)}`);

  const walletAddrNoToken = mockClient('sid-addr');
  room.onJoin(walletAddrNoToken, { playerId: '0x1234567890abcdef1234567890abcdef12345678' });
  check('join with a raw wallet address but no token is rejected',
    walletAddrNoToken.leaves.some((l) => l.code === 4003 && l.msg === 'wallet_required'),
    `leaves=${JSON.stringify(walletAddrNoToken.leaves)}`);

  const bogusToken = mockClient('sid-bogus');
  room.onJoin(bogusToken, { name: 'X', authToken: 'definitely-not-a-real-session-token' });
  check('join with an invalid authToken is rejected (4001 auth_token_invalid)',
    bogusToken.leaves.some((l) => l.code === 4001 && l.msg === 'auth_token_invalid'),
    `leaves=${JSON.stringify(bogusToken.leaves)}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail === 0 ? 0 : 1);
});
