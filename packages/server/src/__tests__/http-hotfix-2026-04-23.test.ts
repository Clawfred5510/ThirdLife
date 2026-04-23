/**
 * HTTP-layer hotfix verification — rate limit + auth failure logging.
 * Uses dynamic require AFTER setting env vars (ESM imports hoist).
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import express from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-http-'));
process.env.DATABASE_PATH = path.join(tmp, 'test.db');
delete process.env.TEST_BALANCE;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const agentApi = require('../api/agent-api').default as express.Router;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const db = require('../db') as typeof import('../db');
const { getEvents, seedParcels } = db;

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

  // ── Register an agent to get a real API key ────────────────────────────
  const regRes = await fetch(`${base}/agents/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'RateTester', personality: 'trader', strategy_preset: 'balanced' }),
  });
  const reg = await regRes.json();
  const apiKey: string = reg.api_key;
  check('registration returns api_key', typeof apiKey === 'string' && apiKey.startsWith('tl_sk_'));

  // ── Bug 5: auth failure logs an event ──────────────────────────────────
  console.log('\n[Bug 5: auth failure logging]');
  const eventsBefore = getEvents(500).filter(e => e.type === 'auth_failure').length;

  // Missing header
  const r1 = await fetch(`${base}/actions/work`, { method: 'POST' });
  check('401 when no auth header', r1.status === 401);

  // Invalid key
  const r2 = await fetch(`${base}/actions/work`, {
    method: 'POST',
    headers: { Authorization: 'Bearer tl_sk_bogus_key_for_test_only_abc123' },
  });
  check('401 when invalid key', r2.status === 401);

  const eventsAfter = getEvents(500).filter(e => e.type === 'auth_failure').length;
  check(
    'auth_failure events logged (2 new)',
    eventsAfter - eventsBefore === 2,
    `before=${eventsBefore} after=${eventsAfter}`,
  );

  const latest = getEvents(5).find(e => e.type === 'auth_failure');
  const payload = latest ? JSON.parse(latest.data) : {};
  check('auth_failure event has ip + path + reason', !!payload.ip && !!payload.path && !!payload.reason);
  check('invalid_key event scrubs full key (only hint)', payload.key_hint !== 'tl_sk_bogus_key_for_test_only_abc123');

  // ── Bug 4: rate limit after burst ──────────────────────────────────────
  console.log('\n[Bug 4: rate limiting]');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  // /actions/work is cheap and authenticated; blast until we see a 429
  let sawOk = false;
  let firstRejectStatus = 0;
  const firstRejectBody: any = {};
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${base}/actions/work`, { method: 'POST', headers, body: JSON.stringify({}) });
    if (r.status === 200) sawOk = true;
    if (r.status === 429) {
      firstRejectStatus = 429;
      Object.assign(firstRejectBody, await r.json());
      break;
    }
  }
  check('at least one 200 before burst cap', sawOk);
  check('rate limiter returns 429 after burst', firstRejectStatus === 429);
  check('429 body has rate-limit error message', typeof firstRejectBody.error === 'string' && /rate/i.test(firstRejectBody.error));

  // ── Cleanup ────────────────────────────────────────────────────────────
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
});
