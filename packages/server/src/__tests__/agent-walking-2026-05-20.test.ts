/**
 * Agent walking + visibility verification.
 *
 *   Run with: npx tsx src/__tests__/agent-walking-2026-05-20.test.ts
 *
 * Covers the two bugs fixed on 2026-05-20:
 *   1. parcelWorldPos: server formula now matches the client's 45×45 grid
 *      (was hardcoded for 50×50, agents teleported ~124u away from buildings)
 *   2. Agents walk toward a target waypoint at PLAYER_SPEED per second
 *      instead of snapping. The per-frame stepAgents() shape is tested by
 *      replicating the loop here (the actual fn is private to GameRoom).
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { parcelWorldPos, PLAYER_SPEED, GRID_COLS, GRID_ROWS } from '@gamestu/shared';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-walk-'));
process.env.DATABASE_PATH = path.join(tmp, 'test.db');
delete process.env.TEST_BALANCE;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${name}`); pass += 1; }
  else { console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); fail += 1; }
}
function section(n: string): void { console.log(`\n[${n}]`); }

// ── 1. parcelWorldPos canonical formula ──────────────────────────────────
section('parcelWorldPos: server↔client agreement');
// Mirrors packages/client/src/game/entities/buildings.ts generateParcelGrid:
//   x = gx * STRIDE - GRID_TOTAL_W/2 + CELL_SIZE/2
// with STRIDE=48, GRID_TOTAL_W = 45*40 + 44*8 = 2152, CELL_SIZE/2 = 20.
const CELL_SIZE = 40;
const ROAD_WIDTH = 8;
const STRIDE = CELL_SIZE + ROAD_WIDTH;
const GRID_TOTAL_W = GRID_COLS * CELL_SIZE + (GRID_COLS - 1) * ROAD_WIDTH;

function clientFormula(gx: number, gy: number): { x: number; z: number } {
  const GRID_TOTAL_H = GRID_ROWS * CELL_SIZE + (GRID_ROWS - 1) * ROAD_WIDTH;
  return {
    x: gx * STRIDE - GRID_TOTAL_W / 2 + CELL_SIZE / 2,
    z: gy * STRIDE - GRID_TOTAL_H / 2 + CELL_SIZE / 2,
  };
}

for (const [gx, gy] of [[0, 0], [22, 22], [44, 44], [10, 30]]) {
  const a = parcelWorldPos(gx, gy);
  const b = clientFormula(gx, gy);
  check(
    `parcel(${gx},${gy}) matches client formula`,
    Math.abs(a.x - b.x) < 0.001 && Math.abs(a.z - b.z) < 0.001,
    `shared=(${a.x},${a.z}) client=(${b.x},${b.z})`,
  );
}

// Centre parcel: 45/2 floor = 22, expected x/z = 0 (centre of the world).
const centre = parcelWorldPos(22, 22);
check('centre parcel near (0,0)', Math.abs(centre.x) < 1 && Math.abs(centre.z) < 1,
  `centre=(${centre.x},${centre.z})`);

// ── 2. stepAgents math: walks at PLAYER_SPEED, stops on arrival ──────────
section('stepAgents: continuous walk toward target');

interface Agent { x: number; z: number; tx: number; tz: number; rotation: number }
function step(a: Agent, dt: number): void {
  const ARRIVE = 0.5;
  const max = PLAYER_SPEED * dt;
  const dx = a.tx - a.x;
  const dz = a.tz - a.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= ARRIVE) { a.x = a.tx; a.z = a.tz; return; }
  if (dist <= max) { a.x = a.tx; a.z = a.tz; }
  else { a.x += (dx / dist) * max; a.z += (dz / dist) * max; }
  a.rotation = Math.atan2(dx, dz);
}

const agent: Agent = { x: 0, z: 0, tx: 100, tz: 0, rotation: 0 };

// One frame at 60Hz (~16.7ms) → should advance ~PLAYER_SPEED * 0.0167 ≈ 0.167u
step(agent, 1 / 60);
check('one 60Hz frame advances ~PLAYER_SPEED/60', Math.abs(agent.x - PLAYER_SPEED / 60) < 0.01,
  `x=${agent.x}`);

// Run for 1 simulated second at 60Hz; should have advanced ~10u.
for (let i = 0; i < 59; i++) step(agent, 1 / 60);
check('1s of walking covers ~10 units', Math.abs(agent.x - PLAYER_SPEED) < 0.5, `x=${agent.x}`);

// Run for 10s — should snap to target (100u away, PLAYER_SPEED=10).
for (let i = 0; i < 60 * 10; i++) step(agent, 1 / 60);
check('arrives at target', Math.abs(agent.x - 100) < 0.5 && Math.abs(agent.z) < 0.5,
  `final=(${agent.x},${agent.z})`);

// After arrival, further steps don't move the agent.
const settledX = agent.x;
const settledZ = agent.z;
for (let i = 0; i < 60; i++) step(agent, 1 / 60);
check('stays put once arrived', agent.x === settledX && agent.z === settledZ);

// Diagonal target: ensures normalisation works (no faster on diagonals).
const a2: Agent = { x: 0, z: 0, tx: 30, tz: 40, rotation: 0 }; // 50u away
for (let i = 0; i < 60 * 5; i++) step(a2, 1 / 60);
check('5s diagonal walk covers ~50u', Math.abs(a2.x - 30) < 0.5 && Math.abs(a2.z - 40) < 0.5,
  `pos=(${a2.x},${a2.z})`);

// Rotation faces direction of travel.
const a3: Agent = { x: 0, z: 0, tx: 100, tz: 0, rotation: 0 };
step(a3, 1 / 60);
// dx=100, dz=0 → atan2(100, 0) = π/2 (~1.5708)
check('rotation faces motion direction', Math.abs(a3.rotation - Math.PI / 2) < 0.001,
  `rot=${a3.rotation}`);

// ── 3. Per-100ms broadcast includes agents ───────────────────────────────
section('PLAYER_STATE broadcast: agents included');
// We can't easily boot Colyseus here, but the bug was a structural one:
// the broadcast payload must include both human players and agents. This
// is enforced in GameRoom.ts update() — we read the file and confirm the
// shape contains both arrays.
const grSrc = fs.readFileSync(
  path.join(__dirname, '..', 'rooms', 'GameRoom.ts'),
  'utf8',
);
const periodicBroadcastBlock = grSrc.split('// ---- Broadcast player positions at fixed rate ----')[1]
  ?.split('// ---- Tick economy ----')[0] ?? '';
check('broadcast includes humans',
  /this\.players\.values\(\)/.test(periodicBroadcastBlock));
check('broadcast includes agents',
  /this\.agentPlayers\.values\(\)/.test(periodicBroadcastBlock),
  'this is the disappearance fix — without it agents render briefly then vanish 100ms later');

// ── 4. Registration spawn path uses the canonical formula (2026-05-31) ────
// The 2026-05-20 fix corrected parcelWorldPos + autopilot + client, but the
// REST registration path in agent-api.ts kept the stale `grid * 48 - 1200`
// formula, so newly-registered agents (and all external agents, which never
// get an autopilot pass) spawned ~124u from their building. These checks
// guard that regression at the source level + verify the magnitude.
section('agent registration: canonical spawn (no stale 50×50 formula)');

// Magnitude: the old centring offset (-1180 at grid 0) vs the canonical one
// (parcelWorldPos, -1056 at grid 0) differs by exactly 124u on each axis.
for (const [gx, gy] of [[0, 0], [10, 30], [44, 44]]) {
  const stale = { x: gx * 48 - 1200 + 20, z: gy * 48 - 1200 + 20 };
  const good = parcelWorldPos(gx, gy);
  check(`stale formula was ~124u off the canonical at (${gx},${gy})`,
    Math.abs((good.x - stale.x) - 124) < 0.001 && Math.abs((good.z - stale.z) - 124) < 0.001,
    `Δx=${(good.x - stale.x).toFixed(1)} Δz=${(good.z - stale.z).toFixed(1)}`);
}

// The agent "door" offset (12u south) matches autopilot.parcelDoor so the
// registration spawn lands exactly on the first autopilot waypoint.
const apiSrc = fs.readFileSync(path.join(__dirname, '..', 'api', 'agent-api.ts'), 'utf8');
check('agent-api.ts no longer contains the stale `* 48 - 1200` formula',
  !/\*\s*48\s*-\s*1200/.test(apiSrc),
  'found the old 50×50 grid formula — agents would spawn ~124u from their worksite');
check('agent-api.ts spawns via parcelWorldPos()',
  /parcelWorldPos\(/.test(apiSrc));
check('agent-api.ts applies the 12u door offset (z - 12)',
  /z\s*-\s*12/.test(apiSrc));

const autoSrc = fs.readFileSync(path.join(__dirname, '..', 'autopilot', 'index.ts'), 'utf8');
check('autopilot.parcelDoor uses the same z - 12 door offset',
  /parcelWorldPos\(/.test(autoSrc) && /z\s*-\s*12/.test(autoSrc));

// GameRoom.refreshAgents recomputes canonical placement on load (backfills
// agents persisted with the old formula, and removes the income-tick wait).
check('GameRoom.refreshAgents places agents via parcelWorldPos',
  /parcelWorldPos\(placeParcel\.grid_x,\s*placeParcel\.grid_y\)/.test(grSrc),
  'refreshAgents should recompute the worksite door so misplaced agents self-correct on load');

// ── Done ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
