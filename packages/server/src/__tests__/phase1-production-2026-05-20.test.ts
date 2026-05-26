/**
 * Phase 1 production verification — exercises the new base+agent
 * production formula, binary energy gating, passive luxury, and the
 * material-cost enforcement on construction.
 *
 * Replaces tick-economy-2026-04-23.test.ts.disabled (which tested the
 * pre-tier flat-rate model that no longer exists).
 *
 * Run with: npx tsx src/__tests__/phase1-production-2026-05-20.test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  BUILDINGS,
  BuildingType,
  TIER_MULTIPLIER,
  LUXURY_PASSIVE_PER_TICK_BY_TIER,
  FOOD_PER_AGENT_PER_TICK,
  ENERGY_PER_PRODUCING_BUILDING_PER_TICK,
  consumesEnergy,
  emitsPassiveLuxury,
} from '@gamestu/shared';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-prod-'));
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
  claimAndBuild,
} = db;

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); passed += 1; }
  else { console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); failed += 1; }
}
function section(name: string): void { console.log(`\n[${name}]`); }

seedParcels();
const allParcels = getAllParcels();

function placeBuilding(playerId: string, buildingType: BuildingType): number {
  const next = allParcels.find(p => !p.owner_id);
  if (!next) throw new Error('no free parcel');
  // claimParcel requires LAND_COST in the player's wallet. Tests don't
  // care about $AMETA accounting on land here — they're testing tick
  // production. Top the player up before claiming.
  updatePlayerCredits(playerId, 1_000_000);
  const ok = claimParcel(next.id, playerId);
  if (!ok) throw new Error(`claim failed for player=${playerId} parcel=${next.id}`);
  setBuildingType(next.id, buildingType);
  updateBusiness(next.id, playerId, { type: buildingType, name: BUILDINGS[buildingType].label });
  next.owner_id = playerId;
  return next.id;
}

/** Port of GameRoom's Phase 1 settle loop, parameterised by which
 *  players are "connected" this tick + how many produce-agents each
 *  parcel has assigned. */
function settleOneTick(
  connectedPlayerIds: string[],
  produceAgentsByParcel: Map<number, number> = new Map(),
): void {
  interface Producer { parcelId: number; category: string; tier: number; agents: number }
  interface OwnerBucket {
    producers: Producer[];
    passiveLuxury: number;
  }
  const byOwner = new Map<string, OwnerBucket>();
  const getBucket = (id: string): OwnerBucket => {
    let b = byOwner.get(id);
    if (!b) {
      b = { producers: [], passiveLuxury: 0 };
      byOwner.set(id, b);
    }
    return b;
  };

  for (const row of getOwnedBuiltParcels()) {
    const bt = row.building_type as BuildingType;
    const spec = BUILDINGS[bt];
    if (!spec) continue;
    const b = getBucket(row.owner_id);

    if (consumesEnergy(bt)) {
      b.producers.push({
        parcelId: row.id, category: spec.category, tier: spec.tier,
        agents: produceAgentsByParcel.get(row.id) ?? 0,
      });
    } else if (emitsPassiveLuxury(bt)) {
      const idx = Math.max(0, spec.tier - 1);
      b.passiveLuxury += LUXURY_PASSIVE_PER_TICK_BY_TIER[idx] ?? 0;
    }
  }

  for (const pid of connectedPlayerIds) {
    const bucket = byOwner.get(pid);
    const resources = getPlayerResources(pid);

    if (bucket) {
      const sorted = [...bucket.producers].sort((a, b2) => a.parcelId - b2.parcelId);
      const poweredCount = Math.min(
        sorted.length,
        Math.floor(resources.energy / ENERGY_PER_PRODUCING_BUILDING_PER_TICK),
      );
      resources.energy -= poweredCount * ENERGY_PER_PRODUCING_BUILDING_PER_TICK;
      for (let i = 0; i < poweredCount; i++) {
        const p = sorted[i];
        const mult = TIER_MULTIPLIER[p.tier - 1] ?? 0;
        const out = mult * (1 + p.agents);
        if (p.category === 'food')           resources.food      += out;
        else if (p.category === 'materials') resources.materials += out;
        else if (p.category === 'energy')    resources.energy    += out;
      }
      resources.luxury += bucket.passiveLuxury;
    }
    resources.food = Math.max(0, resources.food - FOOD_PER_AGENT_PER_TICK);
    updatePlayerResources(pid, resources);
  }
}

// ── Spec constants ──────────────────────────────────────────────────────
section('Locked v1 building costs');
check('Tier I Farm $AMETA cost = 50_000', BUILDINGS.farm.cost === 50_000);
check('Tier I Farm material cost = 0',    BUILDINGS.farm.materialCost === 0);
check('Tier II Ranch $AMETA cost = 200_000', BUILDINGS.ranch.cost === 200_000);
check('Tier II Ranch material cost = 2_000', BUILDINGS.ranch.materialCost === 2_000);
check('Tier V Synthetic Protein Lab cost = 10M', BUILDINGS.synthetic_protein_lab.cost === 10_000_000);
check('Tier V Mansion (luxury) cost = 12M', BUILDINGS.mansion.cost === 12_000_000);
check('Tier I Office category = luxury-civic', BUILDINGS.office.category === 'luxury-civic');
check('factory category = energy + tier 1', BUILDINGS.factory.category === 'energy' && BUILDINGS.factory.tier === 1);

// ── Tier I farm: base + agents formula ─────────────────────────────────
section('Tier I farm: base + agents × tier_multiplier');
getOrCreatePlayer('alice', 'Alice');
const farmId = placeBuilding('alice', 'farm');

// Give alice 1 energy so the farm can run.
let r = getPlayerResources('alice');
r.energy = 1;
updatePlayerResources('alice', r);
settleOneTick(['alice']);
r = getPlayerResources('alice');
check('farm with 0 agents + 1 energy → 1 food (- 1 food consumed) = 0',
  r.food === 0, `food=${r.food}`);
// Energy consumed: 1 (the farm). Net energy after: 0.
check('farm consumed 1 energy', r.energy === 0, `energy=${r.energy}`);

// Two agents at the farm: output = 1 × (1 + 2) = 3 food.
r = getPlayerResources('alice');
r.energy = 1;
updatePlayerResources('alice', r);
const farmAgents = new Map<number, number>([[farmId, 2]]);
settleOneTick(['alice'], farmAgents);
r = getPlayerResources('alice');
// Total food gained this tick: 3. Food consumed: 1. Net: 2 added to whatever was there.
check('farm with 2 agents + 1 energy → 1×(1+2)=3 food, -1 consumed = 2 net',
  r.food === 2, `food=${r.food}`);

// No energy: farm produces 0.
r = getPlayerResources('alice');
r.food = 0;
r.energy = 0;
updatePlayerResources('alice', r);
settleOneTick(['alice']);
r = getPlayerResources('alice');
check('farm with 0 energy → 0 food output, food floored at 0',
  r.food === 0, `food=${r.food}`);

// ── Tier I coal power (factory): energy economics ──────────────────────
section('Tier I coal power: needs 1 energy to bootstrap');
getOrCreatePlayer('bob', 'Bob');
const coalId = placeBuilding('bob', 'factory');

// Bob has 0 energy: coal can't run.
let rb = getPlayerResources('bob');
rb.energy = 0;
updatePlayerResources('bob', rb);
settleOneTick(['bob']);
rb = getPlayerResources('bob');
check('coal with 0 energy → cannot bootstrap, energy still 0',
  rb.energy === 0, `energy=${rb.energy}`);

// Bob has 1 energy: coal consumes 1, produces 1 × (1+0) = 1. Net 0.
rb = getPlayerResources('bob');
rb.energy = 1;
updatePlayerResources('bob', rb);
settleOneTick(['bob']);
rb = getPlayerResources('bob');
check('coal with 1 energy, 0 agents → break-even (energy still 1? actually 0+1=1 in, -1 spent, +1 made → 1)',
  rb.energy === 1, `energy=${rb.energy}`);

// With 1 agent: coal consumes 1, produces 1×(1+1)=2. Net +1 energy.
rb = getPlayerResources('bob');
rb.energy = 1;
updatePlayerResources('bob', rb);
const coalAgents = new Map<number, number>([[coalId, 1]]);
settleOneTick(['bob'], coalAgents);
rb = getPlayerResources('bob');
check('coal with 1 energy + 1 produce-agent → +1 net energy',
  rb.energy === 2, `energy=${rb.energy}`);

// ── Apartment (housing): passive luxury, no energy ─────────────────────
section('Apartment: passive luxury, no energy required');
getOrCreatePlayer('carl', 'Carl');
placeBuilding('carl', 'apartment');
let rc = getPlayerResources('carl');
rc.energy = 0;
rc.luxury = 0;
updatePlayerResources('carl', rc);
settleOneTick(['carl']);
rc = getPlayerResources('carl');
check('Tier-I apartment yields LUXURY_PASSIVE_PER_TICK_BY_TIER[0] = 1 luxury, no energy needed',
  rc.luxury === LUXURY_PASSIVE_PER_TICK_BY_TIER[0], `luxury=${rc.luxury}`);

// ── Material cost enforcement ──────────────────────────────────────────
section('Material cost: Tier-II Ranch needs 2_000 materials');
getOrCreatePlayer('dana', 'Dana');
updatePlayerCredits('dana', 1_000_000);
const free = allParcels.find(p => !p.owner_id);
if (!free) throw new Error('no free parcel');
// Without materials, ranch claim fails.
let res = claimAndBuild('dana', free.id, 'ranch', BUILDINGS.ranch.cost, BUILDINGS.ranch.label, BUILDINGS.ranch.materialCost);
check('ranch claim rejected without materials',
  res.ok === false && res.reason === 'insufficient_materials',
  `result=${JSON.stringify(res)}`);

// Give materials, retry.
const dr = getPlayerResources('dana');
dr.materials = 5_000;
updatePlayerResources('dana', dr);
res = claimAndBuild('dana', free.id, 'ranch', BUILDINGS.ranch.cost, BUILDINGS.ranch.label, BUILDINGS.ranch.materialCost);
check('ranch claim ok with 5_000 materials in pool', res.ok === true,
  `result=${JSON.stringify(res)}`);
const dr2 = getPlayerResources('dana');
check('materials deducted by exactly 2_000', dr2.materials === 3_000, `materials=${dr2.materials}`);

// ── Tier multiplier sanity ─────────────────────────────────────────────
section('Tier multipliers match spec §2');
check('TIER_MULTIPLIER = [1,2,3,5,10]',
  TIER_MULTIPLIER[0] === 1 && TIER_MULTIPLIER[1] === 2 && TIER_MULTIPLIER[2] === 3
  && TIER_MULTIPLIER[3] === 5 && TIER_MULTIPLIER[4] === 10);
check('LUXURY_PASSIVE_PER_TICK_BY_TIER matches CRAFT_BURN_VALUE_BY_TIER (1/3/6/12/25)',
  LUXURY_PASSIVE_PER_TICK_BY_TIER[0] === 1 && LUXURY_PASSIVE_PER_TICK_BY_TIER[1] === 3
  && LUXURY_PASSIVE_PER_TICK_BY_TIER[2] === 6 && LUXURY_PASSIVE_PER_TICK_BY_TIER[3] === 12
  && LUXURY_PASSIVE_PER_TICK_BY_TIER[4] === 25);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
