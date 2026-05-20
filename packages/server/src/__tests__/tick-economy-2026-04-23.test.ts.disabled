/**
 * Tick economy verification — matches thirdlifeworld.xyz /docs spec:
 *   - Farm 5 food/tick, Mine 3 materials/tick, Factory 4 energy/tick, Shop 2 luxury/tick
 *   - Every active agent eats 1 food/tick
 *   - Each income-paying building needs 1 energy/tick to actually pay
 *   - Market prices: food 500 / materials 1000 / energy 1500 / luxury 2500
 *
 * Runs the tick-apply logic in-process against a real SQLite DB. Does NOT
 * boot GameRoom; mirrors its settle-loop so the test is fast and isolated.
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  BUILDINGS,
  BuildingType,
  TICK_PRODUCTION,
  FOOD_PER_AGENT_PER_TICK,
  ENERGY_PER_INCOME_BUILDING_PER_TICK,
  BASE_MARKET_PRICES,
} from '@gamestu/shared';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-tick-'));
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
  getOwnedBuiltParcels,
  getPlayerResources,
  updatePlayerResources,
  setBuildingType,
  updateBusiness,
} = db;

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function section(name: string) { console.log(`\n[${name}]`); }

// ── Scaffolding ─────────────────────────────────────────────────────────
seedParcels();
const allParcels = getAllParcels();

function giveParcelWithBuilding(playerId: string, buildingType: BuildingType): number {
  const next = allParcels.find(p => !p.owner_id);
  if (!next) throw new Error('no free parcel');
  updatePlayerCredits(playerId, 1_000_000);
  const ok = claimParcel(next.id, playerId);
  if (!ok) throw new Error('claim failed');
  setBuildingType(next.id, buildingType);
  updateBusiness(next.id, playerId, { type: buildingType, name: buildingType });
  next.owner_id = playerId;
  return next.id;
}

/** Minimal port of GameRoom's tick-economy settle loop, keyed by test player id. */
function settleOneTick(connectedPlayerIds: string[]) {
  interface OwnerBucket {
    produce: { food: number; materials: number; energy: number; luxury: number };
    incomeBuildings: number;
    pendingIncomePer: number[];
  }
  const byOwner = new Map<string, OwnerBucket>();
  const getBucket = (id: string) => {
    let b = byOwner.get(id);
    if (!b) { b = { produce: { food: 0, materials: 0, energy: 0, luxury: 0 }, incomeBuildings: 0, pendingIncomePer: [] }; byOwner.set(id, b); }
    return b;
  };
  for (const row of getOwnedBuiltParcels()) {
    const spec = BUILDINGS[row.building_type as BuildingType];
    if (!spec) continue;
    const tick = TICK_PRODUCTION[row.building_type as BuildingType];
    const b = getBucket(row.owner_id);
    if (tick) b.produce[tick.resource] += tick.rate;
    if (spec.income > 0) { b.incomeBuildings += 1; b.pendingIncomePer.push(spec.income); }
  }
  for (const sid of connectedPlayerIds) {
    const bucket = byOwner.get(sid);
    const resources = getPlayerResources(sid);
    if (bucket) {
      resources.food += bucket.produce.food;
      resources.materials += bucket.produce.materials;
      resources.energy += bucket.produce.energy;
      resources.luxury += bucket.produce.luxury;
    }
    resources.food = Math.max(0, resources.food - FOOD_PER_AGENT_PER_TICK);
    let paid = 0;
    if (bucket && bucket.incomeBuildings > 0) {
      const max = Math.floor(resources.energy / ENERGY_PER_INCOME_BUILDING_PER_TICK);
      const payouts = Math.min(max, bucket.incomeBuildings);
      resources.energy -= payouts * ENERGY_PER_INCOME_BUILDING_PER_TICK;
      const sorted = [...bucket.pendingIncomePer].sort((a, b) => b - a);
      for (let i = 0; i < payouts; i++) paid += sorted[i];
    }
    updatePlayerResources(sid, resources);
    if (paid > 0) updatePlayerCredits(sid, getPlayerCredits(sid) + paid);
  }
}

// ── Canonical rates (match /docs) ───────────────────────────────────────
section('Canonical rates match /docs');
check('Farm produces 5 food/tick', TICK_PRODUCTION.farm?.rate === 5);
check('Mine produces 3 materials/tick', TICK_PRODUCTION.mine?.rate === 3);
check('Factory produces 4 energy/tick', TICK_PRODUCTION.factory?.rate === 4);
check('Shop produces 2 luxury/tick', TICK_PRODUCTION.shop?.rate === 2);
check('FOOD_PER_AGENT_PER_TICK = 1', FOOD_PER_AGENT_PER_TICK === 1);
check('ENERGY_PER_INCOME_BUILDING = 1', ENERGY_PER_INCOME_BUILDING_PER_TICK === 1);
check('food market price 500', BASE_MARKET_PRICES.food === 500);
check('materials market price 1000', BASE_MARKET_PRICES.materials === 1000);
check('energy market price 1500', BASE_MARKET_PRICES.energy === 1500);
check('luxury market price 2500', BASE_MARKET_PRICES.luxury === 2500);

// ── Building costs match canonical ──────────────────────────────────────
section('Building costs match /developers table');
check('apartment 50_000', BUILDINGS.apartment.cost === 50_000);
check('house 75_000', BUILDINGS.house.cost === 75_000);
check('shop 100_000', BUILDINGS.shop.cost === 100_000);
check('farm 150_000', BUILDINGS.farm.cost === 150_000);
check('market 200_000', BUILDINGS.market.cost === 200_000);
check('office 250_000', BUILDINGS.office.cost === 250_000);
check('mine 300_000', BUILDINGS.mine.cost === 300_000);
check('hall 400_000', BUILDINGS.hall.cost === 400_000);
check('factory 500_000', BUILDINGS.factory.cost === 500_000);
check('bank 2_000_000', BUILDINGS.bank.cost === 2_000_000);

// ── Tick behaviour ──────────────────────────────────────────────────────
section('Tick: farm produces food (5/tick) minus 1 food consumed');
getOrCreatePlayer('alice', 'Alice');
updatePlayerResources('alice', { food: 0, materials: 0, energy: 0, luxury: 0 });
giveParcelWithBuilding('alice', 'farm');
settleOneTick(['alice']);
const r1 = getPlayerResources('alice');
check('alice food = 5 - 1 = 4', r1.food === 4, `got ${r1.food}`);
check('alice materials = 0 (no mine)', r1.materials === 0);

section('Tick: factory gives energy; income building burns it');
// alice owns farm; add a factory + a market (income 20)
giveParcelWithBuilding('alice', 'factory');
giveParcelWithBuilding('alice', 'market');
updatePlayerResources('alice', { food: 10, materials: 0, energy: 0, luxury: 0 });
const before = getPlayerCredits('alice');
settleOneTick(['alice']);
const r2 = getPlayerResources('alice');
// food: 10 + 5 (farm) - 1 (consumption) = 14
check('food = 14', r2.food === 14, `got ${r2.food}`);
// energy: 0 + 4 (factory) - 1 (market burn) = 3
check('energy = 3', r2.energy === 3, `got ${r2.energy}`);
// credits: +20 (market paid because had energy)
check('credits + 20', getPlayerCredits('alice') === before + 20, `diff=${getPlayerCredits('alice') - before}`);

section('Tick: no energy → no income');
updatePlayerResources('alice', { food: 10, materials: 0, energy: 0, luxury: 0 });
// but no factory to refill — wait, alice HAS a factory. Let's remove factory effect by first-settle.
// Actually simpler: set energy=0 AND skip: we need a player without a factory.
getOrCreatePlayer('bob', 'Bob');
updatePlayerResources('bob', { food: 10, materials: 0, energy: 0, luxury: 0 });
giveParcelWithBuilding('bob', 'apartment'); // income=5
const bobBefore = getPlayerCredits('bob');
settleOneTick(['bob']);
check('bob credits unchanged (no energy)', getPlayerCredits('bob') === bobBefore);
const bobR = getPlayerResources('bob');
check('bob food = 10 - 1 = 9', bobR.food === 9, `got ${bobR.food}`);
check('bob energy still 0', bobR.energy === 0);

section('Tick: partial payout when energy < income buildings');
getOrCreatePlayer('carl', 'Carl');
updatePlayerResources('carl', { food: 10, materials: 0, energy: 1, luxury: 0 });
giveParcelWithBuilding('carl', 'apartment'); // income 5
giveParcelWithBuilding('carl', 'bank');      // income 200
const carlBefore = getPlayerCredits('carl');
settleOneTick(['carl']);
// Only 1 energy → 1 payout, highest-income (bank 200)
check('carl gets bank only (200)', getPlayerCredits('carl') === carlBefore + 200, `diff=${getPlayerCredits('carl') - carlBefore}`);
check('carl energy now 0', getPlayerResources('carl').energy === 0);

section('Tick: food floors at 0, not negative');
getOrCreatePlayer('dan', 'Dan');
updatePlayerResources('dan', { food: 0, materials: 0, energy: 0, luxury: 0 });
settleOneTick(['dan']);
check('dan food stays 0', getPlayerResources('dan').food === 0);

// ── Cleanup ──────────────────────────────────────────────────────────────
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
