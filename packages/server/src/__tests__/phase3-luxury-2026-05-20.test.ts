/**
 * Phase 3 luxury / crafting / burn verification.
 *
 *   - 15-item catalog correctness
 *   - Craft tick consumes input resource → mints items at tier multiplier
 *   - Crafting blocked when building lacks energy
 *   - Burn action deducts items + increments lifetime_luxury_burned
 *
 * Run with: npx tsx src/__tests__/phase3-luxury-2026-05-20.test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  BUILDINGS,
  LUXURY_ITEMS,
  LUXURY_ITEM_KINDS,
  ITEM_FOR_BUILDING,
  type BuildingType,
  type LuxuryItemKind,
  TIER_MULTIPLIER,
  CRAFT_RESOURCES_PER_ITEM,
  CRAFT_BURN_VALUE_BY_TIER,
  consumesEnergy,
  ENERGY_PER_PRODUCING_BUILDING_PER_TICK,
} from '@gamestu/shared';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-p3-'));
process.env.DATABASE_PATH = path.join(tmp, 'test.db');
delete process.env.TEST_BALANCE;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const db = require('../db') as typeof import('../db');
const {
  getOrCreatePlayer,
  updatePlayerCredits,
  seedParcels,
  claimParcel,
  getAllParcels,
  getPlayerResources,
  updatePlayerResources,
  setBuildingType,
  updateBusiness,
  getPlayerItems,
  addPlayerItems,
  burnLuxuryItems,
  getLifetimeLuxuryBurned,
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
  updatePlayerCredits(playerId, 1_000_000);
  const ok = claimParcel(next.id, playerId);
  if (!ok) throw new Error('claim failed');
  setBuildingType(next.id, buildingType);
  updateBusiness(next.id, playerId, { type: buildingType, name: BUILDINGS[buildingType].label });
  next.owner_id = playerId;
  return next.id;
}

// Local port of GameRoom's craft step (just the parts we're testing here).
function runCraftAtParcel(playerId: string, parcelId: number, buildingType: BuildingType, craftAgents: number): void {
  const spec = BUILDINGS[buildingType];
  if (!consumesEnergy(buildingType)) return;
  const tierMult = TIER_MULTIPLIER[spec.tier - 1] ?? 0;
  const r = getPlayerResources(playerId);
  if (r.energy < ENERGY_PER_PRODUCING_BUILDING_PER_TICK) return;
  r.energy -= ENERGY_PER_PRODUCING_BUILDING_PER_TICK;
  // Base output: tier_multiplier (no agents needed for this test).
  if (spec.category === 'food')      r.food      += tierMult;
  else if (spec.category === 'materials') r.materials += tierMult;
  else if (spec.category === 'energy')    r.energy    += tierMult;
  // Crafting
  const itemKind = ITEM_FOR_BUILDING[buildingType];
  if (!itemKind) return;
  let produced = 0;
  for (let c = 0; c < craftAgents; c++) {
    const cost = CRAFT_RESOURCES_PER_ITEM * tierMult;
    let avail: number;
    if (spec.category === 'food')      avail = r.food;
    else if (spec.category === 'materials') avail = r.materials;
    else                               avail = r.energy;
    if (avail < cost) break;
    if (spec.category === 'food')      r.food -= cost;
    else if (spec.category === 'materials') r.materials -= cost;
    else                               r.energy -= cost;
    produced += tierMult;
  }
  updatePlayerResources(playerId, r);
  if (produced > 0) addPlayerItems(playerId, itemKind, produced);
  void parcelId;
}

// ── Catalog ────────────────────────────────────────────────────────────
section('Catalog: 15 named items, 1 per production building');
check('15 item kinds exist', LUXURY_ITEM_KINDS.length === 15);
const buildingsCovered = new Set<BuildingType>();
for (const k of LUXURY_ITEM_KINDS) buildingsCovered.add(LUXURY_ITEMS[k].building);
check('15 distinct production buildings covered', buildingsCovered.size === 15);
check('Artisan Jam comes from farm', LUXURY_ITEMS.artisan_jam.building === 'farm');
check('Fusion Core comes from cold_fusion_facility', LUXURY_ITEMS.fusion_core.building === 'cold_fusion_facility');
check('Cut Gemstone burns for 1 (Tier I)', LUXURY_ITEMS.cut_gemstone.burnValue === 1);
check('Designer Wagyu burns for 25 (Tier V)', LUXURY_ITEMS.designer_wagyu.burnValue === 25);
check('CRAFT_BURN_VALUE_BY_TIER matches item burn values',
  CRAFT_BURN_VALUE_BY_TIER[0] === 1 && CRAFT_BURN_VALUE_BY_TIER[4] === 25);

// ── Crafting tick ──────────────────────────────────────────────────────
section('Crafting tick: consume input, mint items at tier_multiplier');

getOrCreatePlayer('crafter', 'Crafter');
const farmId = placeBuilding('crafter', 'farm');
// Give 100 food + 10 energy to bootstrap.
let r = getPlayerResources('crafter');
r.food = 100; r.energy = 10;
updatePlayerResources('crafter', r);

runCraftAtParcel('crafter', farmId, 'farm', 1);
r = getPlayerResources('crafter');
const items = getPlayerItems('crafter');
// Tier I farm: base output 1 food. 1 craft agent consumes 5 food, mints 1 jam.
// Starting: 100 food. After tick: 100 + 1 (base) - 5 (craft) = 96.
check('food balance: 100 + 1 base - 5 craft = 96', r.food === 96, `food=${r.food}`);
check('artisan_jam quantity = 1', items.artisan_jam === 1, `items=${JSON.stringify(items)}`);

// Crafting on a higher-tier building: ranch (T2, 2× multiplier).
getOrCreatePlayer('crafter2', 'Crafter2');
const ranchId = placeBuilding('crafter2', 'ranch');
let r2 = getPlayerResources('crafter2');
r2.food = 100; r2.energy = 10;
updatePlayerResources('crafter2', r2);
runCraftAtParcel('crafter2', ranchId, 'ranch', 1);
r2 = getPlayerResources('crafter2');
const items2 = getPlayerItems('crafter2');
// Tier II: base 2 food, craft cost 5*2=10, mints 2 charcuterie. Start 100 → 100+2-10 = 92.
check('ranch food = 100 + 2 - 10 = 92', r2.food === 92, `food=${r2.food}`);
check('aged_charcuterie quantity = 2', items2.aged_charcuterie === 2, `items=${JSON.stringify(items2)}`);

// ── Energy gate blocks crafting ────────────────────────────────────────
section('Energy gate: no energy → no production AND no crafting');
getOrCreatePlayer('noenergy', 'NoEnergy');
const farmId3 = placeBuilding('noenergy', 'farm');
let r3 = getPlayerResources('noenergy');
r3.food = 100; r3.energy = 0;
updatePlayerResources('noenergy', r3);
runCraftAtParcel('noenergy', farmId3, 'farm', 1);
r3 = getPlayerResources('noenergy');
const items3 = getPlayerItems('noenergy');
check('food unchanged (no energy → tick skipped)', r3.food === 100, `food=${r3.food}`);
check('no items minted', (items3.artisan_jam ?? 0) === 0);

// ── Burn action ────────────────────────────────────────────────────────
section('Burn: deducts items, increments lifetime_luxury_burned');
addPlayerItems('crafter', 'cut_gemstone', 5);
let before = getLifetimeLuxuryBurned('crafter');
let burn = burnLuxuryItems('crafter', 'cut_gemstone', 3, LUXURY_ITEMS.cut_gemstone.burnValue);
check('burn 3 gemstones ok', burn.ok === true);
check('gained = 3 * 1 = 3', burn.gained === 3);
check('lifetime advanced by 3', burn.lifetime === before + 3);
let inv = getPlayerItems('crafter');
check('cut_gemstone now 2 (5 - 3)', inv.cut_gemstone === 2);

// Insufficient items rejected.
const rej = burnLuxuryItems('crafter', 'cut_gemstone', 99, 1);
check('burn 99 rejected (insufficient_items)', rej.ok === false && rej.reason === 'insufficient_items');

// Cumulative across burns.
addPlayerItems('crafter', 'designer_wagyu', 10);
before = getLifetimeLuxuryBurned('crafter');
burn = burnLuxuryItems('crafter', 'designer_wagyu', 10, LUXURY_ITEMS.designer_wagyu.burnValue);
check('burn 10 Diamond items ok', burn.ok === true);
check('gained = 10 * 25 = 250', burn.gained === 250);
check('lifetime cumulative', burn.lifetime === before + 250);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
