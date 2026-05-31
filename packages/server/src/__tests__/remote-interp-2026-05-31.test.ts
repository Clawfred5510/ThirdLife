/**
 * Remote-player interpolation regression test (2026-05-31).
 *
 *   Run with: npx tsx src/__tests__/remote-interp-2026-05-31.test.ts
 *
 * Proves the fix for the MAJOR "other players settle off-position,
 * permanently" bug. The 2026-05-28 interpolator derived per-axis velocity
 * from jittery client packet-ARRIVAL timestamps and EXTRAPOLATED forward
 * (target + v·age), so a just-stopped remote avatar overshot its true spot
 * and a moving one rendered where the server never reported. The
 * replacement (shared.sampleSnapshot) interpolates BETWEEN the two most
 * recent snapshots at a fixed delay behind real time and never projects past
 * the latest — so the rendered position equals the authoritative server
 * position at rest, no matter the arrival jitter.
 *
 * Pure math, no Babylon — sampleSnapshot lives in @gamestu/shared exactly so
 * the interpolation can be tested deterministically (headless Chromium can't
 * run Babylon's render loop, per project memory).
 */
import { sampleSnapshot, INTERP_DELAY_MS, REMOTE_PLAYER_LERP } from '@gamestu/shared';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${name}`); pass += 1; }
  else { console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); fail += 1; }
}
function section(n: string): void { console.log(`\n[${n}]`); }
const approx = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

/** The OLD (buggy) extrapolation, replicated here to demonstrate the
 *  regression the new code fixes. Projects forward from the latest snapshot
 *  using velocity from the previous interval. */
function oldExtrapolate(prev: number, next: number, prevAt: number, nextAt: number, now: number): number {
  const broadcastDt = Math.max(nextAt - prevAt, 1);
  const v = (next - prev) / broadcastDt; // u/ms
  const ageMs = Math.min(now - nextAt, 250);
  return next + v * ageMs;
}

// ── 1. Config sanity ─────────────────────────────────────────────────────
section('config');
check('INTERP_DELAY_MS buffers past one 100ms broadcast interval',
  INTERP_DELAY_MS > 100 && INTERP_DELAY_MS <= 250, `got ${INTERP_DELAY_MS}`);
check('REMOTE_PLAYER_LERP still in (0,1) for yaw smoothing',
  REMOTE_PLAYER_LERP > 0 && REMOTE_PLAYER_LERP < 1, `got ${REMOTE_PLAYER_LERP}`);

// ── 2. The stop-overshoot case (the actual bug) ──────────────────────────
section('stop overshoot');
{
  // Sprint at 20 u/s = 2u per 100ms broadcast. Two moving snapshots, then
  // the player stops; the authoritative resting position is 10.
  const prev = 8, prevAt = 1000;   // moving
  const next = 10, nextAt = 1100;  // last broadcast before stop; rest = 10
  const now = 1300;                // 200ms later, no newer packet yet

  const oldVal = oldExtrapolate(prev, next, prevAt, nextAt, now);
  const newVal = sampleSnapshot(prev, next, prevAt, nextAt, now - INTERP_DELAY_MS);

  check('OLD extrapolation overshoots the true stop position', oldVal > next + 1,
    `old=${oldVal.toFixed(2)} vs rest=${next}`);
  check('NEW interpolation holds EXACTLY at authoritative rest position',
    approx(newVal, next), `new=${newVal} expected=${next}`);
}

// ── 3. Converges and STAYS at rest across repeated idle broadcasts ────────
section('rest convergence');
{
  // Server keeps broadcasting the same idle position (10) every 100ms.
  // prev == next == 10. Rendered position must equal 10 for any render time.
  let worst = 0;
  for (let now = 1100; now <= 5000; now += 37) {
    const v = sampleSnapshot(10, 10, now - 100, now, now - INTERP_DELAY_MS);
    worst = Math.max(worst, Math.abs(v - 10));
  }
  check('rendered position never deviates from authoritative idle position',
    worst < 1e-9, `worst deviation=${worst}`);
}

// ── 4. Mid-motion: renders the REAL server path, just delayed ─────────────
section('mid-motion interpolation');
{
  // prev=0 @1000, next=10 @1100 (constant 100 u/s). renderTime in the middle
  // of the segment must return the true midpoint, not an extrapolated value.
  const mid = sampleSnapshot(0, 10, 1000, 1100, 1050);
  check('half-way through the segment renders the midpoint', approx(mid, 5), `got ${mid}`);
  const quarter = sampleSnapshot(0, 10, 1000, 1100, 1025);
  check('quarter through the segment renders the quarter point', approx(quarter, 2.5), `got ${quarter}`);
}

// ── 5. Bounded: NEVER leaves [prev, next] — the anti-overshoot invariant ──
section('bounded output (anti-overshoot invariant)');
{
  let violations = 0;
  // Sweep many render times AND many velocities/positions.
  for (const [prev, next] of [[0, 10], [10, 0], [-5, 5], [3, 3], [100, -100]] as Array<[number, number]>) {
    const lo = Math.min(prev, next), hi = Math.max(prev, next);
    for (let rt = 800; rt <= 1400; rt += 13) {
      const v = sampleSnapshot(prev, next, 1000, 1100, rt);
      if (v < lo - 1e-9 || v > hi + 1e-9) violations += 1;
    }
  }
  check('output always within [min,max] of the two snapshots', violations === 0,
    `${violations} out-of-bounds samples`);
}

// ── 6. Jittery arrivals still converge to the final position ─────────────
section('jitter robustness');
{
  // Simulate a walk that ends, with realistic arrival jitter (broadcasts
  // nominally 100ms apart but arriving 60–160ms apart). Final authoritative
  // position is 50. After motion stops the rendered position must reach and
  // hold 50 regardless of how jittery the arrivals were.
  const arrivals: Array<{ at: number; val: number }> = [];
  let at = 0;
  const jit = [80, 140, 60, 160, 90, 110, 70, 130]; // deterministic "jitter"
  // 5 moving snapshots (10..50), then 5 idle snapshots (all 50).
  const vals = [10, 20, 30, 40, 50, 50, 50, 50, 50, 50];
  for (let i = 0; i < vals.length; i++) { at += jit[i % jit.length]; arrivals.push({ at, val: vals[i] }); }

  // Render well after the last arrival.
  const lastAt = arrivals[arrivals.length - 1].at;
  const prev = arrivals[arrivals.length - 2];
  const next = arrivals[arrivals.length - 1];
  const rendered = sampleSnapshot(prev.val, next.val, prev.at, next.at, lastAt + 500 - INTERP_DELAY_MS);
  check('rendered position settles exactly on the final authoritative value',
    approx(rendered, 50), `got ${rendered}`);
}

// ── 7. Degenerate inputs are safe ────────────────────────────────────────
section('degenerate inputs');
{
  check('zero span (single snapshot / duplicate timestamp) returns latest',
    approx(sampleSnapshot(3, 7, 1000, 1000, 1000), 7));
  check('negative span returns latest (clock weirdness guard)',
    approx(sampleSnapshot(3, 7, 1100, 1000, 1050), 7));
  check('renderTime before the previous snapshot returns the previous value',
    approx(sampleSnapshot(3, 7, 1000, 1100, 500), 3));
  check('no NaN for any of the above',
    Number.isFinite(sampleSnapshot(3, 7, 1000, 1000, 1000)));
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
