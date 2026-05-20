/**
 * Hotfix verification — run with: npx tsx src/__tests__/hotfix-2026-04-23.test.ts
 * Uses a fresh temp SQLite DB each run (no mocks — per repo memory rule).
 *
 * We use a dynamic `require` AFTER setting env vars because ESM `import`
 * statements hoist before any top-level code runs.
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { LAND_COST, INCOME_TICK_MS } from '@gamestu/shared';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-hotfix-'));
process.env.DATABASE_PATH = path.join(tmp, 'test.db');
delete process.env.TEST_BALANCE;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const db = require('../db') as typeof import('../db');
const {
  getOrCreatePlayer,
  updatePlayerCredits,
  getPlayerCredits,
  seedParcels,
  claimParcel,
  getAllParcels,
  buyLand,
  transferCredits,
  workProduce,
  playerExists,
  registerAgent,
  updatePlayerResources,
  getPlayerResources,
} = db;

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function section(name: string) {
  console.log(`\n[${name}]`);
}

// ── Setup ────────────────────────────────────────────────────────────────
seedParcels();
const parcels = getAllParcels();
check('seedParcels populates grid', parcels.length === 2025, `got ${parcels.length}`);

// ── Bug 1: LAND_COST split-brain ─────────────────────────────────────────
section('Bug 1: LAND_COST');
getOrCreatePlayer('alice', 'Alice');
updatePlayerCredits('alice', LAND_COST + 10_000);
const before = getPlayerCredits('alice');
const ok = claimParcel(parcels[0].id, 'alice');
check('claimParcel succeeds with LAND_COST balance', ok === true);
const after = getPlayerCredits('alice');
check(
  `claimParcel deducts exactly LAND_COST (${LAND_COST})`,
  after === before - LAND_COST,
  `before=${before} after=${after} diff=${before - after}`,
);

// Bug 1b: buyLand atomic (no double-charge)
getOrCreatePlayer('bob', 'Bob');
updatePlayerCredits('bob', LAND_COST + 1000);
const bobBefore = getPlayerCredits('bob');
const bl = buyLand('bob', parcels[1].id);
check('buyLand ok', bl.ok === true);
const bobAfter = getPlayerCredits('bob');
check(
  `buyLand charges exactly LAND_COST once (${LAND_COST})`,
  bobAfter === bobBefore - LAND_COST,
  `before=${bobBefore} after=${bobAfter}`,
);

// Bug 1c: under-funded rejected
updatePlayerCredits('bob', 100);
const under = buyLand('bob', parcels[2].id);
check('buyLand rejects under-funded', under.ok === false && under.reason === 'insufficient_balance');

// ── Bug 3: INCOME_TICK_MS is a constant ──────────────────────────────────
// Phase 0 (2026-05-20): bumped to 10 minutes per locked spec §8.
section('Bug 3: INCOME_TICK_MS');
check('INCOME_TICK_MS exported from shared', INCOME_TICK_MS === 10 * 60 * 1000);

// ── Bug 6: transfer target validation ────────────────────────────────────
section('Bug 6: transfer validation');
updatePlayerCredits('alice', 50_000);
const badTarget = transferCredits('alice', 'nonexistent-ghost-user', 1000);
check('transfer rejects non-existent target', badTarget.ok === false && badTarget.reason === 'target_not_found');
check('alice balance unchanged after rejected transfer', getPlayerCredits('alice') === 50_000);

const selfXfer = transferCredits('alice', 'alice', 500);
check('transfer rejects self', selfXfer.ok === false && selfXfer.reason === 'self_transfer');

const zeroXfer = transferCredits('alice', 'bob', 0);
check('transfer rejects zero amount', zeroXfer.ok === false);

const negXfer = transferCredits('alice', 'bob', -100);
check('transfer rejects negative amount', negXfer.ok === false);

const goodXfer = transferCredits('alice', 'bob', 1000);
check('transfer ok to existing player', goodXfer.ok === true);
check('alice debited', getPlayerCredits('alice') === 49_000);
check('bob credited', getPlayerCredits('bob') === 100 + 1000);

// ── Bug 7: atomicity — can't overspend via race ──────────────────────────
section('Bug 7: atomic ops');
getOrCreatePlayer('carl', 'Carl');
updatePlayerCredits('carl', 1000);
const r1 = transferCredits('carl', 'alice', 800);
const r2 = transferCredits('carl', 'alice', 800);
check('first 800-transfer ok', r1.ok === true);
check('second 800-transfer rejected (would overspend)', r2.ok === false && r2.reason === 'insufficient_balance');
check('carl balance = 200 after single transfer', getPlayerCredits('carl') === 200);

// (Legacy tradeSellResources atomicity test removed 2026-05-16 — the
//  flat-price sell path no longer exists. Order-book trades are covered
//  by the matchOrder transactional test in the market suite.)

// workProduce atomicity
const wp = workProduce('alice', 0, { food: 5, materials: 100, energy: 50, luxury: 0 });
check('workProduce returns new balance', typeof wp.credits === 'number');
const resAfterWork = getPlayerResources('alice');
check('workProduce updated resources', resAfterWork.materials === 100 && resAfterWork.energy === 50);

// ── playerExists helper ──────────────────────────────────────────────────
section('playerExists helper');
check('playerExists true for real', playerExists('alice') === true);
check('playerExists false for ghost', playerExists('does-not-exist') === false);

// Agent registration path adds a player row
registerAgent('agent-x', 'AgentX', 'trader', 'balanced', 'tl_sk_fake_for_test', null);
check('registered agent has a player row', playerExists('agent-x') === true);

// ── Cleanup ──────────────────────────────────────────────────────────────
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
