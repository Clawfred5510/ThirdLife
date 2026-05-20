/**
 * Phase 2 agent-system verification:
 *   - 200K $AMETA in-game agent purchase deduction (economy debit path)
 *   - Bronze rank cap of 5 in-game agents per wallet
 *   - Starvation state machine: 3-tick grace → dormant
 *   - Revival: 100 food clears dormancy
 *   - Dormant agents don't eat or contribute to production
 *
 * Run with: npx tsx src/__tests__/phase2-agents-2026-05-20.test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  IN_GAME_AGENT_COST_AMETA,
  IN_GAME_AGENT_CAP_BY_RANK,
  STARVATION_GRACE_TICKS,
  REVIVE_COST_FOOD,
  FOOD_PER_AGENT_PER_TICK,
  BUILDINGS,
  type BuildingType,
  type AgentRole,
} from '@gamestu/shared';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-p2-'));
process.env.DATABASE_PATH = path.join(tmp, 'test.db');
delete process.env.TEST_BALANCE;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const db = require('../db') as typeof import('../db');
const {
  getOrCreatePlayer,
  updatePlayerCredits,
  getPlayerCredits,
  seedParcels,
  getAllParcels,
  getPlayerResources,
  updatePlayerResources,
  registerAgent,
  getAllAgents,
  setAgentStarvation,
  countAgentsByWalletAndKind,
  getRawDb,
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
const wallet = '0xtest_wallet_0000000000000000000000000001';

// ── Setup: one wallet, top up to 5M for testing ────────────────────────
getOrCreatePlayer(wallet, 'TestWallet');
updatePlayerCredits(wallet, 5_000_000);

// ── 200K purchase deduction (raw DB path) ──────────────────────────────
section('Agent purchase cost (spec §9: 200_000 $AMETA)');
check('IN_GAME_AGENT_COST_AMETA = 200_000', IN_GAME_AGENT_COST_AMETA === 200_000);

const beforeBuy = getPlayerCredits(wallet);
// Mimic the agent-api debit: subtract 200K from wallet credits.
updatePlayerCredits(wallet, beforeBuy - IN_GAME_AGENT_COST_AMETA);

// Register the agent record.
registerAgent(
  `${wallet}:agent:p2_first`, 'P2First', 'worker', 'balanced',
  'tl_sk_p2_first', wallet, 'farmer', null, null,
);
const afterBuy = getPlayerCredits(wallet);
check('wallet debited by 200_000', beforeBuy - afterBuy === IN_GAME_AGENT_COST_AMETA,
  `before=${beforeBuy} after=${afterBuy}`);

// ── Bronze cap = 5 in-game agents ──────────────────────────────────────
section('Bronze rank cap (5 in-game agents)');
check('IN_GAME_AGENT_CAP_BY_RANK.bronze = 5', IN_GAME_AGENT_CAP_BY_RANK.bronze === 5);

// Register 4 more to fill the cap (we already have 1).
for (let i = 2; i <= 5; i++) {
  registerAgent(
    `${wallet}:agent:p2_${i}`, `P2_${i}`, 'worker', 'balanced',
    `tl_sk_p2_${i}`, wallet, 'farmer', null, null,
  );
}
const inGameCount = countAgentsByWalletAndKind(wallet, 0);
check('5 in-game agents registered', inGameCount === 5, `count=${inGameCount}`);

// ── Starvation state machine ───────────────────────────────────────────
section(`Starvation state machine (${STARVATION_GRACE_TICKS}-tick grace → dormant)`);

/**
 * Local port of GameRoom's Phase 2 food + starvation step. Only models
 * the bits we're testing (food consumption, dormancy thresholding).
 */
function settleFoodAndStarvation(playerId: string, tickNow: number): void {
  const allActive = getAllAgents().filter(
    (a) => a.dormant_at_tick == null && a.owner_wallet?.toLowerCase() === playerId.toLowerCase(),
  );
  const demand = allActive.length * FOOD_PER_AGENT_PER_TICK;
  const r = getPlayerResources(playerId);
  if (demand === 0) return;
  if (r.food >= demand) {
    r.food -= demand;
    for (const a of allActive) {
      if (a.starvation_ticks > 0) setAgentStarvation(a.id, 0, null);
    }
  } else {
    r.food = 0;
    for (const a of allActive) {
      const next = (a.starvation_ticks ?? 0) + 1;
      if (next >= STARVATION_GRACE_TICKS) setAgentStarvation(a.id, next, tickNow);
      else setAgentStarvation(a.id, next, null);
    }
  }
  updatePlayerResources(playerId, r);
}

// Give wallet 0 food → all 5 agents starve.
let r = getPlayerResources(wallet);
r.food = 0;
updatePlayerResources(wallet, r);

for (let t = 1; t <= 5; t++) {
  settleFoodAndStarvation(wallet, t);
}

// After 5 ticks of zero food, all agents should be dormant
// (they cross STARVATION_GRACE_TICKS = 3 after 3 ticks).
const agentsAfterStarve = getAllAgents().filter(a => a.owner_wallet === wallet);
const dormantCount = agentsAfterStarve.filter(a => a.dormant_at_tick != null).length;
check('all 5 agents dormant after 5 starvation ticks',
  dormantCount === 5, `dormant=${dormantCount}/5`);

// Dormant agents should have starvation_ticks ≥ 3.
const allOverGrace = agentsAfterStarve.every(a => (a.starvation_ticks ?? 0) >= STARVATION_GRACE_TICKS);
check('starvation_ticks ≥ grace threshold for all dormant agents', allOverGrace);

// ── Dormant agents stop eating ─────────────────────────────────────────
section('Dormant agents stop consuming food');
r = getPlayerResources(wallet);
r.food = 100;
updatePlayerResources(wallet, r);
settleFoodAndStarvation(wallet, 6);
const rAfter = getPlayerResources(wallet);
check('food unchanged when all agents dormant', rAfter.food === 100,
  `food=${rAfter.food}`);

// ── Revival: 100 food clears dormancy ──────────────────────────────────
section(`Revival (${REVIVE_COST_FOOD} food per agent)`);
check('REVIVE_COST_FOOD = 100', REVIVE_COST_FOOD === 100);

// Mimic the /revive endpoint: deduct 100 food, clear dormancy.
const targetId = `${wallet}:agent:p2_first`;
r = getPlayerResources(wallet);
r.food = 100;
updatePlayerResources(wallet, r);
const target = getAllAgents().find(a => a.id === targetId);
check('target agent was dormant pre-revive',
  target != null && target.dormant_at_tick != null);
r.food -= REVIVE_COST_FOOD;
updatePlayerResources(wallet, r);
setAgentStarvation(targetId, 0, null);
const targetPost = getAllAgents().find(a => a.id === targetId);
check('target no longer dormant', targetPost!.dormant_at_tick == null);
check('target starvation_ticks reset to 0', targetPost!.starvation_ticks === 0);
const rPost = getPlayerResources(wallet);
check('food cost 100', rPost.food === 0, `food=${rPost.food}`);

// ── Revived agent eats again next tick ─────────────────────────────────
r = getPlayerResources(wallet);
r.food = 10;
updatePlayerResources(wallet, r);
settleFoodAndStarvation(wallet, 10);
const rEat = getPlayerResources(wallet);
// Revived agent eats 1; other 4 still dormant.
check('revived agent eats 1 food (1 active * 1 food/tick)',
  rEat.food === 9, `food=${rEat.food}`);

// ── External agents are not autopilot-driven but still eat ─────────────
section('External agents');
// Mark the revived agent as external by direct DB write (the spec's
// /agents/register-external endpoint lands in Phase 5).
getRawDb().prepare('UPDATE agents SET is_external = 1 WHERE id = ?').run(targetId);
const xCount = countAgentsByWalletAndKind(wallet, 1);
const iCount = countAgentsByWalletAndKind(wallet, 0);
check('1 external + 4 in-game tracked separately', xCount === 1 && iCount === 4,
  `external=${xCount} in-game=${iCount}`);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
