import { PLAYER_SPEED, SPRINT_MULTIPLIER, WORLD_HALF } from './constants';

/**
 * Maximum seconds of movement honoured for a single input command. Clamped
 * IDENTICALLY on the client (prediction + replay) and the server, so:
 *   - a long frame, a paused/backgrounded tab, or a malicious client can't
 *     teleport by sending a huge dt;
 *   - for a given command, client prediction and server simulation always
 *     apply the exact same displacement → reconciliation replay is bit-exact.
 */
export const MAX_COMMAND_DT = 0.05; // 50ms

/**
 * A position correction larger than this (world units) is treated as a
 * teleport (respawn / fast-travel) and hard-snapped on the client rather
 * than slid through collision. Matches the legacy "hard snap at ≥25u" rule.
 */
export const RECONCILE_SNAP_DISTANCE = 25;

/**
 * One client input, stamped with a monotonic sequence number so the server
 * can acknowledge "last processed seq" and the client can replay everything
 * after it during reconciliation. Carries its own dt so client and server
 * apply identical motion regardless of network timing (authoritative-server
 * client-prediction model — Gambetta / Colyseus predicted-input).
 */
export interface InputCommand {
  /** Monotonic per-client sequence number. */
  seq: number;
  /** Seconds this command represents (clamped to MAX_COMMAND_DT on apply). */
  dt: number;
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint?: boolean;
  /** Camera/facing yaw in radians. Forward on XZ is (sin yaw, cos yaw). */
  yaw: number;
}

export interface MoveState {
  x: number;
  z: number;
}

/** Type guard: is this payload a sequenced InputCommand (vs legacy boolean state)? */
export function isInputCommand(msg: unknown): msg is InputCommand {
  const m = msg as Partial<InputCommand> | null;
  return !!m && typeof m.seq === 'number' && typeof m.dt === 'number';
}

/**
 * Pure, deterministic movement step — THE single source of truth for player
 * movement. Run identically by:
 *   - client prediction (every frame the player has input),
 *   - client reconciliation replay (re-applying unacked commands), and
 *   - the authoritative server (once per received command).
 *
 * Camera-yaw-relative, diagonal-normalised, sprint-aware, world-bounds
 * clamped. NO building collision — that is a client-only render refinement
 * (the server is authoritative on free movement; both sides agree here, so
 * reconciliation never fights on open ground, which is what caused the
 * "ice slide": the old server kept integrating a held input over wall-clock
 * time during the release-latency window, then the client's lerp dragged the
 * avatar to that overshoot. This model moves the avatar by EXACTLY the
 * commands the client sent — no phantom post-release motion).
 */
export function simulateMovement(state: MoveState, cmd: InputCommand): MoveState {
  const dt = Math.min(Math.max(cmd.dt, 0), MAX_COMMAND_DT);
  const yaw = Number.isFinite(cmd.yaw) ? cmd.yaw : 0;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  let mx = 0;
  let mz = 0;
  if (cmd.forward) { mx += fx; mz += fz; }
  if (cmd.backward) { mx -= fx; mz -= fz; }
  if (cmd.right) { mx += rx; mz += rz; }
  if (cmd.left) { mx -= rx; mz -= rz; }
  const len = Math.hypot(mx, mz);
  if (len === 0) return { x: state.x, z: state.z };
  mx /= len;
  mz /= len;
  const speed = PLAYER_SPEED * (cmd.sprint ? SPRINT_MULTIPLIER : 1) * dt;
  return {
    x: Math.max(-WORLD_HALF, Math.min(WORLD_HALF, state.x + mx * speed)),
    z: Math.max(-WORLD_HALF, Math.min(WORLD_HALF, state.z + mz * speed)),
  };
}
