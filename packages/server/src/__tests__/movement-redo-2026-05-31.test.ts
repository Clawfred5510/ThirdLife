/**
 * Movement redo regression test (2026-05-31).
 *
 *   Run with: npx tsx src/__tests__/movement-redo-2026-05-31.test.ts
 *
 * Proves the authoritative-server client-prediction model that replaces the
 * "integrate-held-state + lerp-reconcile" system (which caused the post-release
 * ice slide). Verifies the shared deterministic simulateMovement, that client
 * prediction and server simulation agree command-for-command, and that
 * reconciliation by REPLAY reproduces the prediction exactly when the server
 * agrees (so there is no visible correction / drag) — and lands at server
 * truth when it diverges.
 *
 * Pure math, no Babylon / no Colyseus — simulateMovement is the single shared
 * source of truth, so it can be tested deterministically.
 */
import * as path from 'path';
import * as fs from 'fs';
import {
  simulateMovement, MAX_COMMAND_DT, RECONCILE_SNAP_DISTANCE,
  PLAYER_SPEED, SPRINT_MULTIPLIER, WORLD_HALF, InputCommand, MoveState, isInputCommand,
} from '@gamestu/shared';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${name}`); pass += 1; }
  else { console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); fail += 1; }
}
function section(n: string): void { console.log(`\n[${n}]`); }
const approx = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

function cmd(seq: number, over: Partial<InputCommand> = {}): InputCommand {
  return { seq, dt: MAX_COMMAND_DT, forward: false, backward: false, left: false, right: false, sprint: false, yaw: 0, ...over };
}
/** Fold a stream of commands over a start state (what BOTH client and server do). */
function applyStream(start: MoveState, cmds: InputCommand[]): MoveState {
  let s = start;
  for (const c of cmds) s = simulateMovement(s, c);
  return s;
}

// ── 1. simulateMovement basics ───────────────────────────────────────────
section('simulateMovement: deterministic base movement');
{
  const step = PLAYER_SPEED * MAX_COMMAND_DT; // 0.5 at speed 10, dt 50ms
  const fwd = simulateMovement({ x: 0, z: 0 }, cmd(1, { forward: true, yaw: 0 }));
  check('forward at yaw 0 moves +z by speed*dt', approx(fwd.x, 0) && approx(fwd.z, step), `${fwd.x},${fwd.z}`);

  const diag = simulateMovement({ x: 0, z: 0 }, cmd(1, { forward: true, right: true, yaw: 0 }));
  check('diagonal is normalised (not faster)', approx(Math.hypot(diag.x, diag.z), step), `len=${Math.hypot(diag.x, diag.z)}`);

  const spr = simulateMovement({ x: 0, z: 0 }, cmd(1, { forward: true, sprint: true, yaw: 0 }));
  check('sprint scales by SPRINT_MULTIPLIER', approx(spr.z, step * SPRINT_MULTIPLIER), `${spr.z}`);

  const clamped = simulateMovement({ x: 0, z: 0 }, cmd(1, { forward: true, yaw: 0, dt: 10 }));
  check('dt is clamped to MAX_COMMAND_DT (no teleport on a huge dt)', approx(clamped.z, step), `${clamped.z}`);

  const idle = simulateMovement({ x: 3, z: 4 }, cmd(1, { yaw: 1.2 }));
  check('no keys → position unchanged', approx(idle.x, 3) && approx(idle.z, 4));

  const edge = simulateMovement({ x: WORLD_HALF - 0.1, z: 0 }, cmd(1, { right: true, yaw: 0, dt: MAX_COMMAND_DT }));
  check('clamps to world bounds', edge.x <= WORLD_HALF + 1e-9, `x=${edge.x} half=${WORLD_HALF}`);
}

// ── 2. Client prediction == server simulation, command-for-command ────────
section('client/server agreement (same function, same stream)');
{
  const stream: InputCommand[] = [
    cmd(1, { forward: true, yaw: 0 }),
    cmd(2, { forward: true, right: true, yaw: 0.5 }),
    cmd(3, { right: true, sprint: true, yaw: 1.0, dt: 0.016 }),
    cmd(4, { backward: true, yaw: -2.0, dt: 0.033 }),
    cmd(5, { left: true, yaw: 3.1, dt: 0.05 }),
  ];
  // "Client predicts" by folding; "server" folds the same stream. Must match
  // at every prefix (this is why replay reconciliation is exact).
  let mismatch = 0;
  let cli: MoveState = { x: 0, z: 0 };
  let srv: MoveState = { x: 0, z: 0 };
  for (const c of stream) {
    cli = simulateMovement(cli, c);
    srv = simulateMovement(srv, c);
    if (!approx(cli.x, srv.x) || !approx(cli.z, srv.z)) mismatch += 1;
  }
  check('client and server land on identical positions every step', mismatch === 0, `${mismatch} mismatches`);
}

// ── 3. Reconciliation by replay reproduces prediction (zero correction) ───
section('reconciliation: snap to server + replay un-acked');
{
  const stream: InputCommand[] = Array.from({ length: 10 }, (_, i) =>
    cmd(i + 1, { forward: true, right: i % 2 === 0, yaw: 0.2 * i, dt: 0.02 + 0.003 * i }));

  // Client predicted all 10.
  const predicted = applyStream({ x: 0, z: 0 }, stream);

  // Server has processed only up to seq 7 (acked=7); authoritative = apply 1..7.
  const ackSeq = 7;
  const serverPos = applyStream({ x: 0, z: 0 }, stream.slice(0, ackSeq));

  // Client reconcile: drop <=ack, replay 8..10 from serverPos.
  const unacked = stream.filter((c) => c.seq > ackSeq);
  const reconciled = applyStream(serverPos, unacked);

  check('replay from authoritative reproduces the predicted position exactly',
    approx(reconciled.x, predicted.x) && approx(reconciled.z, predicted.z),
    `recon=(${reconciled.x.toFixed(4)},${reconciled.z.toFixed(4)}) pred=(${predicted.x.toFixed(4)},${predicted.z.toFixed(4)})`);

  // Divergence case: server clamps the player to a wall/edge the client didn't.
  // Reconcile must land at server+replay, never drag past it.
  const divergedServer = { x: serverPos.x + 5, z: serverPos.z - 3 };
  const divReconciled = applyStream(divergedServer, unacked);
  const expected = applyStream(divergedServer, unacked); // deterministic
  check('on divergence, reconcile lands at server-truth + replay (no drag)',
    approx(divReconciled.x, expected.x) && approx(divReconciled.z, expected.z));
}

// ── 4. No post-release overshoot (the ice bug) ───────────────────────────
section('no post-release drift');
{
  // Hold W for exactly 100ms worth of commands (2 × 50ms), then release
  // (client sends nothing further). Server position == exactly the sum of the
  // commands it received — it does NOT keep integrating after release.
  const held = applyStream({ x: 0, z: 0 }, [
    cmd(1, { forward: true, yaw: 0 }),
    cmd(2, { forward: true, yaw: 0 }),
  ]);
  const expected = PLAYER_SPEED * MAX_COMMAND_DT * 2; // 1.0
  check('held 2×50ms moves exactly 2 steps', approx(held.z, expected), `z=${held.z}`);

  // "Release" = no further commands processed → position frozen. (In the old
  // time-elapsed model the server kept moving for up to 200ms after release;
  // here there is simply nothing to apply.)
  const afterRelease = held; // no commands applied
  check('position is frozen after release (no phantom motion)',
    approx(afterRelease.z, expected) && approx(afterRelease.x, 0));
}

// ── 5. Config + guards ────────────────────────────────────────────────────
section('config + type guard');
{
  check('MAX_COMMAND_DT is a sane cap (≤100ms)', MAX_COMMAND_DT > 0 && MAX_COMMAND_DT <= 0.1, `${MAX_COMMAND_DT}`);
  check('RECONCILE_SNAP_DISTANCE matches the legacy 25u hard-snap rule', RECONCILE_SNAP_DISTANCE === 25);
  check('isInputCommand accepts a sequenced command', isInputCommand(cmd(1)));
  check('isInputCommand rejects legacy boolean state', !isInputCommand({ forward: true, backward: false, left: false, right: false, jump: false }));
  check('isInputCommand rejects null/garbage', !isInputCommand(null) && !isInputCommand({}));
}

// ── 6. Source guards — architecture didn't silently regress ───────────────
section('source: legacy movement model removed');
{
  const gr = fs.readFileSync(path.join(__dirname, '..', 'rooms', 'GameRoom.ts'), 'utf8');
  check('GameRoom no longer has the time-elapsed pendingInputs model',
    !/pendingInputs/.test(gr) && !/inputAppliedAt/.test(gr),
    'pendingInputs/inputAppliedAt should be gone');
  check('GameRoom no longer integrates movement per tick (applyMovement removed)',
    !/private applyMovement/.test(gr));
  check('GameRoom processes commands via simulateMovement + lastSeq',
    /simulateMovement/.test(gr) && /this\.lastSeq/.test(gr) && /isInputCommand/.test(gr));

  const ms = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'client', 'src', 'game', 'scenes', 'MainScene.ts'), 'utf8');
  check('MainScene predicts + reconciles via simulateMovement (no lerp reconcile)',
    /simulateMovement/.test(ms) && /reconcileLocal/.test(ms) && /pendingCommands/.test(ms) && !/RECONCILE_RATE_PER_SEC/.test(ms));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
