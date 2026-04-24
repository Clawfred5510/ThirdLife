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
const r = claimAndBuild('alice', parcels[0].id, 'apartment', spec.cost, spec.label);
check('returned ok', r.ok === true);
check(`charged LAND_COST + cost (${LAND_COST + spec.cost})`,
  before - getPlayerCredits('alice') === LAND_COST + spec.cost,
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

section('Bank (2M building) costs full 2M + land');
getOrCreatePlayer('carl', 'Carl');
updatePlayerCredits('carl', 2_500_000);
const bankBefore = getPlayerCredits('carl');
const bankSpec = BUILDINGS.bank;
const rb = claimAndBuild('carl', parcels[2].id, 'bank', bankSpec.cost, bankSpec.label);
check('bank claim ok', rb.ok === true);
check(`bank total = 2_150_000 (2M + 150K land)`,
  bankBefore - getPlayerCredits('carl') === 2_150_000,
  `diff=${bankBefore - getPlayerCredits('carl')}`);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
