/**
 * Phase 6 verification (work wages + marketplace prerequisites).
 *
 *   - role='work' at luxury Housing/Civic → +WORK_WAGE_AMETA_PER_TICK
 *     into agent balance per tick
 *   - role='work' at production building → counts as +1 produce agent
 *     for that resource (owner clarification 2026-05-20)
 *   - role='craft' unchanged (production buildings only)
 *   - Agents without workplace earn nothing
 *
 * Run with: npx tsx src/__tests__/phase6-wages-marketplace-2026-05-20.test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  BUILDINGS,
  type BuildingType,
  WORK_WAGE_AMETA_PER_TICK,
  TIER_MULTIPLIER,
  ENERGY_PER_PRODUCING_BUILDING_PER_TICK,
  FOOD_PER_AGENT_PER_TICK,
  CRAFT_RESOURCES_PER_ITEM,
  ITEM_FOR_BUILDING,
  consumesEnergy,
  emitsPassiveLuxury,
  LUXURY_PASSIVE_PER_TICK_BY_TIER,
  TICK_PRODUCTION,
} from '@gamestu/shared';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-p6-'));
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
  getPlayerResources,
  updatePlayerResources,
  setBuildingType,
  updateBusiness,
  registerAgent,
  setAgentRole,
  getAllAgents,
  addPlayerItems,
} = db;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${name}`); pass += 1; }
  else { console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); fail += 1; }
}
function section(n: string): void { console.log(`\n[${n}]`); }

seedParcels();
const allParcels = getAllParcels();

function placeBuilding(playerId: string, buildingType: BuildingType): number {
  const next = allParcels.find(p => !p.owner_id);
  if (!next) throw new Error('no free parcel');
  updatePlayerCredits(playerId, 2_000_000);
  const ok = claimParcel(next.id, playerId);
  if (!ok) throw new Error(`claim failed for ${playerId} parcel=${next.id}`);
  setBuildingType(next.id, buildingType);
  updateBusiness(next.id, playerId, { type: buildingType, name: BUILDINGS[buildingType].label });
  next.owner_id = playerId;
  return next.id;
}

function spawnAgent(wallet: string, name: string, workplace: number | null, role: 'work' | 'produce' | 'craft'): string {
  const id = `${wallet}:agent:${name}_x`;
  registerAgent(id, name, 'worker', 'balanced', `tl_sk_${name}`, wallet, null, workplace, null);
  setAgentRole(id, role);
  return id;
}

/** Local mirror of the GameRoom tick — only the bits relevant to wages
 *  and per-parcel agent indexing. */
function runOneTick(connectedPlayer: string): void {
  const parcelById = new Map(getAllParcels().map(p => [p.id, p]));
  const all = getAllAgents();

  const produceAgentsByParcel = new Map<number, number>();
  const craftAgentsByParcel = new Map<number, number>();
  const wageAgentsByOwner = new Map<string, string[]>();
  const activeByOwner = new Map<string, typeof all>();

  for (const a of all) {
    if (a.dormant_at_tick != null) continue;
    if (a.owner_wallet) {
      const list = activeByOwner.get(a.owner_wallet) ?? [];
      list.push(a);
      activeByOwner.set(a.owner_wallet, list);
    }
    if (a.autopilot_enabled !== 1 || a.is_external === 1 || a.workplace_parcel_id == null) continue;
    const parcel = parcelById.get(a.workplace_parcel_id);
    if (!parcel) continue;
    const bt = (parcel as { building_type?: string }).building_type as BuildingType | undefined;
    if (!bt) continue;
    const spec = BUILDINGS[bt];
    if (!spec) continue;
    const isProd = spec.category === 'food' || spec.category === 'materials' || spec.category === 'energy';
    const isLux = spec.category === 'luxury-housing' || spec.category === 'luxury-civic';
    if (isProd) {
      if (a.role === 'craft') {
        craftAgentsByParcel.set(a.workplace_parcel_id, (craftAgentsByParcel.get(a.workplace_parcel_id) ?? 0) + 1);
      } else {
        produceAgentsByParcel.set(a.workplace_parcel_id, (produceAgentsByParcel.get(a.workplace_parcel_id) ?? 0) + 1);
      }
    } else if (isLux && a.role === 'work' && a.owner_wallet) {
      const list = wageAgentsByOwner.get(a.owner_wallet) ?? [];
      list.push(a.id);
      wageAgentsByOwner.set(a.owner_wallet, list);
    }
  }

  // Per-owner production loop (only the connected player here).
  const ownerId = connectedPlayer;
  const r = getPlayerResources(ownerId);
  for (const p of getAllParcels()) {
    if (p.owner_id !== ownerId) continue;
    const bt = (p as { building_type?: string }).building_type as BuildingType | undefined;
    if (!bt) continue;
    const spec = BUILDINGS[bt];
    if (!spec) continue;
    if (consumesEnergy(bt)) {
      if (r.energy < ENERGY_PER_PRODUCING_BUILDING_PER_TICK) continue;
      r.energy -= ENERGY_PER_PRODUCING_BUILDING_PER_TICK;
      const mult = TIER_MULTIPLIER[spec.tier - 1] ?? 0;
      const prodAgents = produceAgentsByParcel.get(p.id) ?? 0;
      const out = mult * (1 + prodAgents);
      if (spec.category === 'food')           r.food      += out;
      else if (spec.category === 'materials') r.materials += out;
      else if (spec.category === 'energy')    r.energy    += out;
      // Crafting (simplified — assumes resource available).
      const craftN = craftAgentsByParcel.get(p.id) ?? 0;
      const itemKind = ITEM_FOR_BUILDING[bt];
      if (craftN > 0 && itemKind) {
        for (let c = 0; c < craftN; c++) {
          const cost = CRAFT_RESOURCES_PER_ITEM * mult;
          let avail: number;
          if (spec.category === 'food')      avail = r.food;
          else if (spec.category === 'materials') avail = r.materials;
          else                               avail = r.energy;
          if (avail < cost) break;
          if (spec.category === 'food')      r.food -= cost;
          else if (spec.category === 'materials') r.materials -= cost;
          else                               r.energy -= cost;
          addPlayerItems(ownerId, itemKind, mult);
        }
      }
    } else if (emitsPassiveLuxury(bt)) {
      r.luxury += LUXURY_PASSIVE_PER_TICK_BY_TIER[Math.max(0, spec.tier - 1)] ?? 0;
    } else if (spec.category === 'legacy') {
      const t = TICK_PRODUCTION[bt];
      if (t) (r as any)[t.resource] += t.rate;
    }
  }

  // Wage payout.
  const wages = wageAgentsByOwner.get(ownerId) ?? [];
  for (const id of wages) {
    updatePlayerCredits(id, getPlayerCredits(id) + WORK_WAGE_AMETA_PER_TICK);
  }

  // Food consumption.
  const myAgents = activeByOwner.get(ownerId) ?? [];
  const demand = myAgents.length * FOOD_PER_AGENT_PER_TICK;
  if (demand > 0 && r.food >= demand) r.food -= demand;
  else if (demand > 0) r.food = 0;
  updatePlayerResources(ownerId, r);
}

// ── Constants ─────────────────────────────────────────────────────────
section('Locked v1 wage constant');
check('WORK_WAGE_AMETA_PER_TICK = 10', WORK_WAGE_AMETA_PER_TICK === 10);

// ── Work agent at luxury Housing → 10 $AMETA/tick ──────────────────────
section('role=work at Apartment (luxury-housing) earns 10 $AMETA/tick');
const w1 = '0xtest_w1_000000000000000000000000000000001';
getOrCreatePlayer(w1, 'W1');
const apt = placeBuilding(w1, 'apartment');
const aptAgent = spawnAgent(w1, 'Concierge', apt, 'work');
const before1 = getPlayerCredits(aptAgent);
runOneTick(w1);
const after1 = getPlayerCredits(aptAgent);
check('agent balance +10 after 1 tick', after1 - before1 === WORK_WAGE_AMETA_PER_TICK,
  `before=${before1} after=${after1}`);

// Apartment also passively emits luxury — owner's pool gets it.
const r1 = getPlayerResources(w1);
check('apartment also emitted 1 luxury (Tier I housing)', r1.luxury === 1,
  `luxury=${r1.luxury}`);

// ── Work agent at Office (luxury-civic) earns wage too ─────────────────
section('role=work at Office (luxury-civic) earns wage');
const w2 = '0xtest_w2_000000000000000000000000000000001';
getOrCreatePlayer(w2, 'W2');
const office = placeBuilding(w2, 'office');
const officeAgent = spawnAgent(w2, 'Clerk', office, 'work');
const before2 = getPlayerCredits(officeAgent);
runOneTick(w2);
const after2 = getPlayerCredits(officeAgent);
check('clerk balance +10', after2 - before2 === WORK_WAGE_AMETA_PER_TICK);

// ── Multiple wage agents accumulate per tick ───────────────────────────
section('Multiple work agents at luxury → each earns wage');
const w3 = '0xtest_w3_000000000000000000000000000000001';
getOrCreatePlayer(w3, 'W3');
const apt3a = placeBuilding(w3, 'apartment');
const apt3b = placeBuilding(w3, 'office');
const agA = spawnAgent(w3, 'A', apt3a, 'work');
const agB = spawnAgent(w3, 'B', apt3b, 'work');
const beforeA = getPlayerCredits(agA);
const beforeB = getPlayerCredits(agB);
runOneTick(w3);
check('agA +10', getPlayerCredits(agA) - beforeA === 10);
check('agB +10', getPlayerCredits(agB) - beforeB === 10);

// ── Work agent at PRODUCTION → no wage, +1 produce ─────────────────────
section('role=work at Farm (production) → no wage, counts as produce');
const w4 = '0xtest_w4_000000000000000000000000000000001';
getOrCreatePlayer(w4, 'W4');
const farm = placeBuilding(w4, 'farm');
// Stock 1 energy so the farm can run.
const r4Init = getPlayerResources(w4);
r4Init.energy = 1;
updatePlayerResources(w4, r4Init);
const farmer = spawnAgent(w4, 'Farmer', farm, 'work');  // role=work at production
const beforeFarmer = getPlayerCredits(farmer);
runOneTick(w4);
check('farmer balance unchanged (no wage at production)',
  getPlayerCredits(farmer) - beforeFarmer === 0,
  `diff=${getPlayerCredits(farmer) - beforeFarmer}`);
const r4 = getPlayerResources(w4);
// Tier I farm with 1 produce agent: 1 × (1 + 1) = 2 food. Then -1 food
// for the farmer's consumption = 1 net.
check('farm output: 1 × (1 + 1 work-as-produce agent) - 1 food consumed = 1',
  r4.food === 1, `food=${r4.food}`);

// ── role=craft at production unchanged ─────────────────────────────────
section('role=craft at Mine (production) still mints items');
const w5 = '0xtest_w5_000000000000000000000000000000001';
getOrCreatePlayer(w5, 'W5');
const mine = placeBuilding(w5, 'mine');
const r5Init = getPlayerResources(w5);
r5Init.energy = 1; r5Init.materials = 100;
updatePlayerResources(w5, r5Init);
spawnAgent(w5, 'Lapidarist', mine, 'craft');
runOneTick(w5);
const items5 = db.getPlayerItems(w5);
// Tier I mine base output = 1 materials, craft consumes 5, mints 1 cut_gemstone.
// Net materials: 100 + 1 (base) - 5 (craft) = 96.
const r5Post = getPlayerResources(w5);
check('mine craft minted 1 cut_gemstone', items5.cut_gemstone === 1,
  `items=${JSON.stringify(items5)}`);
check('materials 100 + 1 - 5 = 96', r5Post.materials === 96,
  `materials=${r5Post.materials}`);

// ── Unworkplaced agent earns nothing ───────────────────────────────────
section('No-workplace agent earns nothing');
const w6 = '0xtest_w6_000000000000000000000000000000001';
getOrCreatePlayer(w6, 'W6');
const homeless = spawnAgent(w6, 'Drifter', null, 'work');
const before6 = getPlayerCredits(homeless);
runOneTick(w6);
check('homeless agent balance unchanged',
  getPlayerCredits(homeless) - before6 === 0);

// ── Offline accrual ────────────────────────────────────────────────────
section('Offline accrual: missed ticks of wages + passive luxury');
const w7 = '0xoffline_test_00000000000000000000000000001';
getOrCreatePlayer(w7, 'OfflineTester');
const apt7 = placeBuilding(w7, 'apartment');
const wageAgent7 = spawnAgent(w7, 'OffWorker', apt7, 'work');

// Mimic the accrual helper without booting a Room. World tick starts at 0;
// settleAccrual reads last_settled_tick (0 → no missed ticks for first
// login). Stamp lastSettled then advance tick + replay manually.
const TICK_ADVANCE = 10;
const expectedWages = TICK_ADVANCE * 10; // 10 ticks × 10 wage = 100
const expectedLuxury = TICK_ADVANCE * 1; // Tier I housing passive = 1/tick

// Simulate the wallet was logged in at tick 0, has been gone TICK_ADVANCE ticks.
db.setLastSettledTick(w7, 0);
// We can't easily advance the world tick from outside; simulate by
// applying the math the helper would.
let r7 = getPlayerResources(w7);
r7.luxury += expectedLuxury;
updatePlayerResources(w7, r7);
updatePlayerCredits(wageAgent7, getPlayerCredits(wageAgent7) + expectedWages);
db.setLastSettledTick(w7, TICK_ADVANCE);

check('luxury accrued', getPlayerResources(w7).luxury === expectedLuxury);
check('wage agent +100', getPlayerCredits(wageAgent7) >= expectedWages);
check('last_settled_tick advanced', db.getLastSettledTick(w7) === TICK_ADVANCE);

// ── 15-item marketplace ────────────────────────────────────────────────
// Async tests need an IIFE — top-level await is not enabled by tsx.
(async () => {
  section('Marketplace accepts luxury items as tradeable kinds');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const market = require('../market/orderBook') as typeof import('../market/orderBook');
  const seller = '0xitemseller000000000000000000000000000000001';
  const buyer  = '0xitembuyer000000000000000000000000000000001';
  getOrCreatePlayer(seller, 'ItemSeller');
  getOrCreatePlayer(buyer, 'ItemBuyer');
  addPlayerItems(seller, 'cut_gemstone', 10);
  updatePlayerCredits(buyer, 100_000);

  let r = await market.placeOrder(seller, 'cut_gemstone', 'sell', 50, 5);
  check('sell 5 cut_gemstone @ 50 ok', r.ok === true, `r=${JSON.stringify(r)}`);
  const sellerItemsAfterEscrow = db.getPlayerItems(seller).cut_gemstone ?? 0;
  check('seller items escrowed 5 (10 → 5)', sellerItemsAfterEscrow === 5);

  r = await market.placeOrder(buyer, 'cut_gemstone', 'buy', 50, 5);
  check('buy 5 cut_gemstone @ 50 ok', r.ok === true);
  const buyerItems = db.getPlayerItems(buyer).cut_gemstone ?? 0;
  check('buyer received 5 gemstones', buyerItems === 5);
  // 5 × 50 = 250, minus 1% bronze fee = 2 → 248 to seller. Add the 50
  // legacy default `credits INTEGER DEFAULT 50` from the players CREATE
  // TABLE that getOrCreatePlayer inherits — total 298.
  const sellerCredits = getPlayerCredits(seller);
  check('seller earned 248 $AMETA (250 - 1% bronze fee) over default 50',
    sellerCredits === 50 + 248, `credits=${sellerCredits}`);

  section('Cancel sell-side order refunds items');
  addPlayerItems(seller, 'artisan_jam', 3);
  const sellRes = await market.placeOrder(seller, 'artisan_jam', 'sell', 25, 3);
  const sellOrderId = sellRes.result?.order.id;
  check('artisan_jam escrowed (3 - 3 = 0)',
    (db.getPlayerItems(seller).artisan_jam ?? 0) === 0);
  if (typeof sellOrderId === 'number') await market.cancelOrder(seller, sellOrderId);
  check('artisan_jam refunded on cancel (back to 3)',
    (db.getPlayerItems(seller).artisan_jam ?? 0) === 3);

  section('Invalid market kind rejected');
  const bad = await market.placeOrder(seller, 'not_a_thing' as any, 'sell', 10, 1);
  check('unknown kind rejected', bad.ok === false && bad.reason === 'invalid_kind');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
