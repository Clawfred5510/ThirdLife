/**
 * SIWE auth hardening (2026-05-31, task #22).
 *
 *   Run with: npx tsx src/__tests__/auth-siwe-2026-05-31.test.ts
 *
 * Verifies: a correctly-signed challenge issues a session; full EIP-4361
 * binding is enforced (a tampered domain/chain message is rejected even with a
 * valid signature over it); a stale issued-at is rejected; a nonce is single-
 * use; and a fresh login REVOKES the wallet's prior session (revoke-on-login).
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import express from 'express';
import { privateKeyToAccount } from 'viem/accounts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-auth-'));
process.env.DATABASE_PATH = path.join(tmp, 'test.db');
process.env.SIWE_DOMAIN = 'thirdlife.test';
process.env.SIWE_URI = 'https://thirdlife.test';
delete process.env.TEST_BALANCE;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const authApi = require('../api/auth').default as express.Router;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const db = require('../db') as typeof import('../db');

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); fail++; }
}

const app = express();
app.use(express.json());
app.use('/api/v1/auth', authApi);
const server = http.createServer(app);

server.listen(0, '127.0.0.1', async () => {
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api/v1/auth`;
  // Deterministic test wallet.
  const acct = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
  const address = acct.address;

  async function challenge(): Promise<string> {
    const r = await fetch(`${base}/challenge`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    return (await r.json()).message;
  }
  async function verify(message: string, signature: string) {
    const r = await fetch(`${base}/verify`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address, message, signature }),
    });
    return { status: r.status, body: await r.json() };
  }

  // 1. Happy path — correct signature issues a session.
  const msg1 = await challenge();
  check('challenge message uses the server-side SIWE_DOMAIN, not a request header',
    msg1.startsWith('thirdlife.test wants you to sign in') && msg1.includes('URI: https://thirdlife.test'));
  const sig1 = await acct.signMessage({ message: msg1 });
  const v1 = await verify(msg1, sig1);
  check('valid signature issues a token', v1.status === 200 && typeof v1.body.token === 'string', JSON.stringify(v1.body).slice(0, 120));
  const token1 = v1.body.token;
  check('token resolves to the wallet', db.getAuthSessionPlayerId(token1) === address.toLowerCase());

  // 2. Tampered domain — valid signature OVER the tampered message, but it
  //    must not match the server's canonical binding → rejected.
  const msgT = (await challenge()).replace('thirdlife.test wants', 'evil.example wants');
  const sigT = await acct.signMessage({ message: msgT });
  const vT = await verify(msgT, sigT);
  check('tampered-domain message is rejected despite a valid signature', vT.status === 400, `status=${vT.status}`);

  // 3. Stale issued-at — sign a message dated 1h ago → rejected.
  const msgStale = (await challenge()).replace(/Issued At: .+$/, `Issued At: ${new Date(Date.now() - 3600_000).toISOString()}`);
  const sigStale = await acct.signMessage({ message: msgStale });
  const vStale = await verify(msgStale, sigStale);
  check('stale issued-at is rejected', vStale.status === 400, `status=${vStale.status}`);

  // 4. Nonce single-use — replay the exact happy-path message+sig → rejected.
  const vReplay = await verify(msg1, sig1);
  check('nonce is single-use (replay rejected)', vReplay.status === 400, `status=${vReplay.status}`);

  // 5. Revoke-on-login — a fresh successful login kills the prior token.
  const msg2 = await challenge();
  const sig2 = await acct.signMessage({ message: msg2 });
  const v2 = await verify(msg2, sig2);
  check('second login issues a new token', v2.status === 200 && v2.body.token && v2.body.token !== token1);
  check('prior token is revoked after the new login', db.getAuthSessionPlayerId(token1) === null);
  check('new token is valid', db.getAuthSessionPlayerId(v2.body.token) === address.toLowerCase());

  // 6. TTL ~7 days (default) not 30.
  const ttlDays = (v2.body.expiresAt - Date.now()) / (24 * 60 * 60 * 1000);
  check('session TTL is ~7 days', ttlDays > 6.9 && ttlDays < 7.1, `ttlDays=${ttlDays.toFixed(2)}`);

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
});
