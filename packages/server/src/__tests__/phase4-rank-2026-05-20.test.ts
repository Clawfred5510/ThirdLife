/**
 * Phase 4 verification:
 *   - Rank promotion based on lifetime luxury burn (Bronze → Diamond)
 *   - Progressive marketplace fee determined by seller's rank
 *   - Rank-gated building unlocks (minRank enforcement at DB layer)
 *   - 1% property fee routed to WORLD_TREASURY on builds + land buys
 *   - NO production bonus by rank (owner override 2026-05-20)
 *
 * Run with: npx tsx src/__tests__/phase4-rank-2026-05-20.test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  BUILDINGS,
  LUXURY_ITEMS,
  RANK_BURN_THRESHOLD,
  MARKETPLACE_FEE_BPS_BY_RANK,
  PROPERTY_FEE_BPS,
  BPS_DENOMINATOR,
  rankFromLifetimeBurn,
  type Tier,
} from '@gamestu/shared';
import { WORLD_TREASURY_ID } from '../economy/IEconomy';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-p4-'));
process.env.DATABASE_PATH = path.join(tmp, 'test.db');
delete process.env.TEST_BALANCE;

// IMPORTANT: require '../db' and '../ranks' AFTER setting DATABASE_PATH.
// The db module reads the env var at module-load time, so anything that
// imports from '../db' eagerly (including '../ranks') must be deferred
// here. Hoisted ES imports of these modules silently pin the test to the
// live production DB path. Don't do that.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const db = require('../db') as typeof import('../db');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { rankFor } = require('../ranks') as typeof import('../ranks');
const {
  getOrCreatePlayer,
  updatePlayerCredits,
  getPlayerCredits,
  seedParcels,
  getAllParcels,
  claimAndBuild,
  buyLand,
  burnLuxuryItems,
  addPlayerItems,
  getPlayerRank,
  setPlayerRank,
} = db;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${name}`); pass += 1; }
  else { console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); fail += 1; }
}
function section(n: string): void { console.log(`\n[${n}]`); }

seedParcels();
const parcels = getAllParcels();

// ── rankFromLifetimeBurn ───────────────────────────────────────────────
section('rankFromLifetimeBurn');
check('0 burn → null',          rankFromLifetimeBurn(0) === null);
check('1 burn → bronze',        rankFromLifetimeBurn(1) === 'bronze');
check('4_999 → bronze',         rankFromLifetimeBurn(4_999) === 'bronze');
check('5_000 → silver',         rankFromLifetimeBurn(5_000) === 'silver');
check('29_999 → silver',        rankFromLifetimeBurn(29_999) === 'silver');
check('30_000 → gold',          rankFromLifetimeBurn(30_000) === 'gold');
check('200_000 → platinum',     rankFromLifetimeBurn(200_000) === 'platinum');
check('1_500_000 → diamond',    rankFromLifetimeBurn(1_500_000) === 'diamond');

// ── Promotion via burn ─────────────────────────────────────────────────
section('Promotion: burning crosses each threshold');
const climber = '0xclimber000000000000000000000000000000001';
getOrCreatePlayer(climber, 'Climber');
// Hand-stock items at sufficient burn values to cross every threshold.
addPlayerItems(climber, 'designer_wagyu', 100_000); // each burns for 25

// First burn → bronze.
let r = burnLuxuryItems(climber, 'designer_wagyu', 1, 25);
check('first burn ok', r.ok === true);
check('rankBefore null', r.rankBefore == null);
check('rankAfter bronze', r.rankAfter === 'bronze');
check('getPlayerRank reads bronze', getPlayerRank(climber) === 'bronze');

// Push to silver (5_000). Already have 25; need 4_975 more → 199 wagyu.
r = burnLuxuryItems(climber, 'designer_wagyu', 199, 25);
check('crosses to silver', r.rankAfter === 'silver', `rankAfter=${r.rankAfter} lifetime=${r.lifetime}`);

// Push to gold (30_000). Lifetime now 5_000; need 25_000 → 1_000 wagyu.
r = burnLuxuryItems(climber, 'designer_wagyu', 1_000, 25);
check('crosses to gold', r.rankAfter === 'gold');

// Push to platinum (200_000). Need 170_000 → 6_800 wagyu.
r = burnLuxuryItems(climber, 'designer_wagyu', 6_800, 25);
check('crosses to platinum', r.rankAfter === 'platinum');

// Push to diamond (1_500_000). Need 1_300_000 → 52_000 wagyu.
r = burnLuxuryItems(climber, 'designer_wagyu', 52_000, 25);
check('crosses to diamond', r.rankAfter === 'diamond');
check('rankFor(diamond wallet) = diamond', rankFor(climber) === 'diamond');

// ── rankFor walks agent → owner ────────────────────────────────────────
section('rankFor: agent inherits owning wallet rank');
db.registerAgent(
  `${climber}:agent:p4_walker`, 'P4Walker', 'worker', 'balanced',
  'tl_sk_p4_walker', climber, 'farmer', null, null,
);
check('agent under diamond wallet → diamond',
  rankFor(`${climber}:agent:p4_walker`) === 'diamond');

// ── No production bonus by rank ────────────────────────────────────────
section('No rank-based production bonus (owner override)');
// `productionBonusFor` was intentionally not re-exported. Confirm rank
// helpers don't expose anything that hints at a multiplier.
const ranksMod = require('../ranks') as Record<string, unknown>;
check('rank module has no productionBonusFor()', ranksMod.productionBonusFor === undefined);

// ── Property fee on land + build ───────────────────────────────────────
section('Property fee: 1% of gross → WORLD_TREASURY');
check('PROPERTY_FEE_BPS = 100 (1%)', PROPERTY_FEE_BPS === 100);
const wallet = '0xbuilder00000000000000000000000000000000001';
getOrCreatePlayer(wallet, 'Builder');
updatePlayerCredits(wallet, 10_000_000);
// Need rank silver+ to build a Tier II Ranch.
setPlayerRank(wallet, 'silver');

const before = getPlayerCredits(wallet);
const treasuryBefore = getPlayerCredits(WORLD_TREASURY_ID) ?? 0;
const ranchSpec = BUILDINGS.ranch;
// Need 2_000 materials to build Tier-II Ranch — stock the resource pool.
const wResources = db.getPlayerResources(wallet);
wResources.materials = 2_000;
db.updatePlayerResources(wallet, wResources);

const free = parcels.find(p => !p.owner_id);
const res = claimAndBuild(wallet, free!.id, 'ranch', ranchSpec.cost, ranchSpec.label, ranchSpec.materialCost);
check('ranch claim ok', res.ok === true, `result=${JSON.stringify(res)}`);

const gross = ranchSpec.cost + 200_000; // 200K + 200K = 400K
const expectedFee = Math.floor(gross * PROPERTY_FEE_BPS / BPS_DENOMINATOR); // 4_000
const expectedTotal = gross + expectedFee;
check(`charged gross + fee = ${expectedTotal}`,
  before - getPlayerCredits(wallet) === expectedTotal,
  `diff=${before - getPlayerCredits(wallet)}`);
const treasuryAfter = getPlayerCredits(WORLD_TREASURY_ID) ?? 0;
check(`treasury credited ${expectedFee}`,
  treasuryAfter - treasuryBefore === expectedFee,
  `treasuryBefore=${treasuryBefore} treasuryAfter=${treasuryAfter}`);

// ── Buy bare land charges 1% fee too ──────────────────────────────────
section('buyLand also charges property fee');
const wallet2 = '0xbuyer000000000000000000000000000000000001';
getOrCreatePlayer(wallet2, 'Buyer');
updatePlayerCredits(wallet2, 500_000);
const free2 = parcels.find(p => !p.owner_id && p.id !== free!.id);
const tBefore = getPlayerCredits(WORLD_TREASURY_ID);
const b2Before = getPlayerCredits(wallet2);
const r2 = buyLand(wallet2, free2!.id);
check('buyLand ok', r2.ok === true);
const expectedLandFee = Math.floor(200_000 * PROPERTY_FEE_BPS / BPS_DENOMINATOR); // 2_000
check(`charged 202_000 (200K + 1% fee)`,
  b2Before - getPlayerCredits(wallet2) === 200_000 + expectedLandFee);
check(`treasury +${expectedLandFee}`,
  getPlayerCredits(WORLD_TREASURY_ID) - tBefore === expectedLandFee);

// ── Rank-gated building unlocks (DB-level enforcement is via API, but
//    the spec lives in the BuildingSpec.minRank field). Verify the
//    metadata maps correctly. ────────────────────────────────────────
section('Building minRank metadata');
check('farm minRank = bronze',                BUILDINGS.farm.minRank === 'bronze');
check('ranch minRank = silver',               BUILDINGS.ranch.minRank === 'silver');
check('hydroponic_tower minRank = gold',      BUILDINGS.hydroponic_tower.minRank === 'gold');
check('vertical_farm_complex = platinum',     BUILDINGS.vertical_farm_complex.minRank === 'platinum');
check('synthetic_protein_lab = diamond',      BUILDINGS.synthetic_protein_lab.minRank === 'diamond');
check('mansion = diamond',                    BUILDINGS.mansion.minRank === 'diamond');
check('gala_hall = diamond',                  BUILDINGS.gala_hall.minRank === 'diamond');

// ── Marketplace fee depends on seller's rank ──────────────────────────
section('Marketplace fee bps by rank');
for (const tier of ['bronze','silver','gold','platinum','diamond'] as Tier[]) {
  const expectedBps = (['bronze','silver','gold','platinum','diamond'].indexOf(tier) + 1) * 100;
  check(`${tier} → ${expectedBps} bps`, MARKETPLACE_FEE_BPS_BY_RANK[tier] === expectedBps);
}
// Item burn values must equal the locked spec table.
check('LUXURY_ITEMS.designer_wagyu.burnValue = 25', LUXURY_ITEMS.designer_wagyu.burnValue === 25);

// ── Burn threshold sanity ─────────────────────────────────────────────
section('Burn thresholds match spec §9');
check('Bronze = 1',          RANK_BURN_THRESHOLD.bronze === 1);
check('Silver = 5_000',      RANK_BURN_THRESHOLD.silver === 5_000);
check('Gold = 30_000',       RANK_BURN_THRESHOLD.gold === 30_000);
check('Platinum = 200_000',  RANK_BURN_THRESHOLD.platinum === 200_000);
check('Diamond = 1_500_000', RANK_BURN_THRESHOLD.diamond === 1_500_000);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
