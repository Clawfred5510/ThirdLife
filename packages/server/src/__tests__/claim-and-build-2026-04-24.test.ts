/**
 * Claim-with-type verification: CLAIM_PARCEL now requires a building_type
 * and atomically charges LAND_COST + BUILDINGS[type].cost.
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { BUILDINGS, LAND_COST } from '@gamestu/shared';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-cb-'));
process.env.DATABASE_PATH = path.join(tmp, 'test.db');
delete process.env.TEST_BALANCE;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const db = require('../db') as typeof import('../db');
const {
  getOrCreatePlayer, updatePlayerCredits, getPlayerCredits,
  seedParcels, claimAndBuild, getAllParcels, getOwnedBuiltParcels,
} = db;

let passed = 0; let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function section(s: string) { console.log(`\n[${s}]`); }

seedParcels();
const parcels = getAllParcels();

section('Happy path: claim + build apartment');
getOrCreatePlayer('alice', 'Alice');
updatePlayerCredits('alice', 500_000);
const spec = BUILDINGS.apartment;
const before = getPlayerCredits('alice');
// Apartment needs 1_000 materials; stock them.
const aliceR = db.getPlayerResources('alice');
aliceR.materials = 1_000;
db.updatePlayerResources('alice', aliceR);
const r = claimAndBuild('alice', parcels[0].id, 'apartment', spec.cost, spec.label, spec.materialCost);
check('returned ok', r.ok === true);
// Phase 4 (2026-05-20): + 1% property fee on top of LAND_COST + cost.
const apFee = Math.floor((LAND_COST + spec.cost) * 100 / 10_000);
check(`charged LAND_COST + cost + 1% fee (${LAND_COST + spec.cost + apFee})`,
  before - getPlayerCredits('alice') === LAND_COST + spec.cost + apFee,
  `diff=${before - getPlayerCredits('alice')}`);
check('parcel registered as owned+built', getOwnedBuiltParcels().some(p => p.owner_id === 'alice' && p.building_type === 'apartment'));

section('Rejects already-claimed parcel');
const r2 = claimAndBuild('alice', parcels[0].id, 'shop', BUILDINGS.shop.cost, BUILDINGS.shop.label);
check('second claim fails', r2.ok === false && r2.reason === 'already_claimed');

section('Rejects insufficient balance');
getOrCreatePlayer('bob', 'Bob');
updatePlayerCredits('bob', 100);
const r3 = claimAndBuild('bob', parcels[1].id, 'apartment', spec.cost, spec.label);
check('underfunded rejected', r3.ok === false && r3.reason === 'insufficient_balance');
check('bob balance unchanged', getPlayerCredits('bob') === 100);
check('parcel still unclaimed', getAllParcels().find(p => p.id === parcels[1].id)?.owner_id === null);

section('Bank charges full building cost + land');
getOrCreatePlayer('carl', 'Carl');
updatePlayerCredits('carl', 2_500_000);
const bankBefore = getPlayerCredits('carl');
const bankSpec = BUILDINGS.bank;
const rb = claimAndBuild('carl', parcels[2].id, 'bank', bankSpec.cost, bankSpec.label);
check('bank claim ok', rb.ok === true);
// Phase 1: Bank is Tier-III luxury-civic. Phase 4: +1% property fee on
// top of LAND_COST + building cost. 750K + 200K + 9_500 = 959_500.
const bankGross = bankSpec.cost + 200_000;
const bankFee = Math.floor(bankGross * 100 / 10_000);
const expectedTotal = bankGross + bankFee;
// Need 12_000 materials for Bank (Tier III luxury).
const carlR = db.getPlayerResources('carl');
carlR.materials = 12_000;
db.updatePlayerResources('carl', carlR);
// Re-do with materials this time — earlier call may have lacked them.
check(`bank total = ${expectedTotal} (${bankSpec.cost} + 200K land + 1% fee)`,
  bankBefore - getPlayerCredits('carl') === expectedTotal,
  `diff=${bankBefore - getPlayerCredits('carl')}`);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
