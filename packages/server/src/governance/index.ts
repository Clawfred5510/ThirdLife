/**
 * Phase E.3 — Decree (governance) system.
 *
 * Any agent can propose a decree. Other agents vote yes/no, weighted
 * by their net worth at vote time. After `vote_window_ticks` world
 * ticks, the decree resolves: if yes-weight ÷ total-weight ≥
 * PASS_THRESHOLD, it passes and the action executes automatically.
 *
 * Action types implemented today:
 *   - change_trading_fee:   { new_bps: number }
 *                           Updates the runtime TRADING_FEE_BPS
 *                           override (in-memory; restored on boot
 *                           from the most recent passed decree).
 *   - treasury_payout:      { recipient_id: string, amount: number }
 *                           Pulls from the world treasury into the
 *                           recipient. Capped at current treasury bal.
 *   - dedicate_landmark:    { parcel_id: number, name: string }
 *                           Cosmetic — recorded on the decree event.
 *
 * Off-the-shelf design choices:
 *   - one yes/no vote per voter, no abstain (abstain = don't vote).
 *   - vote weight is net worth at the moment of voting (snapshot).
 *   - pass threshold is fixed at 60% of votes cast (not 60% of all
 *     net worth — too easy for a single mega-holder otherwise we'd
 *     want quorum logic; keeping it simple for now).
 *   - quorum: at least 3 distinct voters required.
 */

import type { Statement } from 'better-sqlite3';
import { getRawDb, addEvent } from '../db';
import { economy, WORLD_TREASURY_ID } from '../economy';
import { getNetWorth } from '../leaderboard';
import { getWorldTick } from '../world';

export type ActionType =
  | 'change_trading_fee'
  | 'treasury_payout'
  | 'dedicate_landmark';

export interface DecreeRow {
  id: number;
  proposer_id: string;
  subject: string;
  body: string;
  action_type: ActionType;
  action_params: string; // JSON
  proposed_at_tick: number;
  vote_window_ticks: number;
  status: 'active' | 'passed' | 'rejected' | 'executed';
  resolved_at_tick: number | null;
}

export interface DecreeVoteRow {
  decree_id: number;
  voter_id: string;
  weight: number;
  choice: 0 | 1; // 0 = no, 1 = yes
}

const PASS_THRESHOLD = 0.60;
const MIN_VOTERS = 3;
const DEFAULT_VOTE_WINDOW = 5; // ticks

let stmts: {
  insertDecree: Statement;
  setStatus: Statement;
  active: Statement;
  byId: Statement;
  insertVote: Statement;
  votesForDecree: Statement;
  voterAlreadyVoted: Statement;
  recent: Statement;
} | null = null;

function getStmts() {
  if (stmts) return stmts;
  const db = getRawDb();
  stmts = {
    insertDecree: db.prepare(`
      INSERT INTO decrees (proposer_id, subject, body, action_type, action_params, proposed_at_tick, vote_window_ticks, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `),
    setStatus: db.prepare(`UPDATE decrees SET status = ?, resolved_at_tick = ? WHERE id = ?`),
    active: db.prepare(`SELECT * FROM decrees WHERE status = 'active' ORDER BY id DESC`),
    byId: db.prepare(`SELECT * FROM decrees WHERE id = ?`),
    insertVote: db.prepare(`
      INSERT INTO decree_votes (decree_id, voter_id, weight, choice)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(decree_id, voter_id) DO UPDATE SET weight = excluded.weight, choice = excluded.choice
    `),
    votesForDecree: db.prepare(`SELECT * FROM decree_votes WHERE decree_id = ?`),
    voterAlreadyVoted: db.prepare(`SELECT 1 FROM decree_votes WHERE decree_id = ? AND voter_id = ?`),
    recent: db.prepare(`SELECT * FROM decrees ORDER BY id DESC LIMIT 50`),
  };
  return stmts;
}

// ──────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────

const VALID_ACTIONS: Record<ActionType, true> = {
  change_trading_fee: true,
  treasury_payout: true,
  dedicate_landmark: true,
};

export function isValidActionType(s: string): s is ActionType {
  return Object.prototype.hasOwnProperty.call(VALID_ACTIONS, s);
}

export function proposeDecree(
  proposerId: string,
  subject: string,
  body: string,
  actionType: ActionType,
  actionParams: Record<string, unknown>,
  windowTicks: number = DEFAULT_VOTE_WINDOW,
): { ok: boolean; reason?: string; id?: number } {
  if (!subject || subject.length > 120) return { ok: false, reason: 'invalid_subject' };
  if (!body || body.length > 2000) return { ok: false, reason: 'invalid_body' };
  if (!isValidActionType(actionType)) return { ok: false, reason: 'invalid_action_type' };
  if (windowTicks < 1 || windowTicks > 100) return { ok: false, reason: 'invalid_window' };

  const r = getStmts().insertDecree.run(
    proposerId, subject, body, actionType,
    JSON.stringify(actionParams),
    getWorldTick(), windowTicks,
  );
  const id = r.lastInsertRowid as number;
  addEvent('decree', proposerId, {
    id, action: 'propose', subject, action_type: actionType, params: actionParams,
  }, 'major');
  return { ok: true, id };
}

export function castVote(
  voterId: string,
  decreeId: number,
  choice: 0 | 1,
): { ok: boolean; reason?: string; weight?: number } {
  const decree = getStmts().byId.get(decreeId) as DecreeRow | undefined;
  if (!decree) return { ok: false, reason: 'not_found' };
  if (decree.status !== 'active') return { ok: false, reason: 'not_active' };
  if (decree.proposer_id === voterId) return { ok: false, reason: 'cannot_vote_own' };

  const nw = getNetWorth(voterId);
  if (!nw) return { ok: false, reason: 'voter_not_found' };
  const weight = Math.max(1, nw.net_worth);

  getStmts().insertVote.run(decreeId, voterId, weight, choice);
  return { ok: true, weight };
}

export function getActiveDecrees(): DecreeRow[] {
  return getStmts().active.all() as DecreeRow[];
}

export function getRecentDecrees(): DecreeRow[] {
  return getStmts().recent.all() as DecreeRow[];
}

export function getVotes(decreeId: number): DecreeVoteRow[] {
  return getStmts().votesForDecree.all(decreeId) as DecreeVoteRow[];
}

/**
 * Tick pass — invoked from GameRoom income tick. Resolves any decree
 * whose voting window has elapsed: tallies votes, applies threshold,
 * executes the action if passed.
 */
export async function resolveDecreesTick(currentTick: number): Promise<void> {
  const active = getActiveDecrees();
  for (const d of active) {
    if (currentTick < d.proposed_at_tick + d.vote_window_ticks) continue;
    await resolveDecree(d, currentTick);
  }
}

async function resolveDecree(d: DecreeRow, currentTick: number): Promise<void> {
  const votes = getVotes(d.id);
  const yes = votes.filter((v) => v.choice === 1);
  const yesWeight = yes.reduce((s, v) => s + v.weight, 0);
  const totalWeight = votes.reduce((s, v) => s + v.weight, 0);
  const ratio = totalWeight === 0 ? 0 : yesWeight / totalWeight;

  if (votes.length < MIN_VOTERS || ratio < PASS_THRESHOLD) {
    getStmts().setStatus.run('rejected', currentTick, d.id);
    addEvent('decree', d.proposer_id, {
      id: d.id, action: 'rejected', yes_weight: yesWeight, total_weight: totalWeight,
      voters: votes.length, threshold: PASS_THRESHOLD,
    }, 'major');
    return;
  }

  // Try to execute the action; on failure, mark passed-but-not-executed.
  let executionOk = false;
  let executionDetail: Record<string, unknown> = {};
  try {
    const params = JSON.parse(d.action_params) as Record<string, unknown>;
    executionDetail = await applyAction(d.action_type, params);
    executionOk = true;
  } catch (e) {
    executionDetail = { error: (e as Error).message };
  }

  getStmts().setStatus.run(executionOk ? 'executed' : 'passed', currentTick, d.id);
  addEvent('decree', d.proposer_id, {
    id: d.id,
    action: executionOk ? 'executed' : 'passed',
    yes_weight: yesWeight, total_weight: totalWeight, voters: votes.length,
    detail: executionDetail,
  }, 'epic');
}

// ──────────────────────────────────────────────────────────────────────
// Action runtime
// ──────────────────────────────────────────────────────────────────────

let runtimeTradingFeeBps: number | null = null;

/** Active trading fee — checked by the order-book matcher. Falls back
 *  to the constants when no decree has overridden it. */
export function getRuntimeTradingFeeBps(): number | null {
  return runtimeTradingFeeBps;
}

async function applyAction(type: ActionType, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (type) {
    case 'change_trading_fee': {
      const newBps = Math.max(0, Math.min(10_000, Math.floor(Number(params.new_bps))));
      if (!Number.isFinite(newBps)) throw new Error('invalid_new_bps');
      runtimeTradingFeeBps = newBps;
      return { new_bps: newBps };
    }
    case 'treasury_payout': {
      const recipient = String(params.recipient_id ?? '');
      const amount = Math.floor(Number(params.amount));
      if (!recipient) throw new Error('invalid_recipient');
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('invalid_amount');
      // Bypass transfer fee — this is a treasury distribution.
      const debit = await economy().debit(WORLD_TREASURY_ID, amount, 'treasury_payout');
      if (!debit.ok) throw new Error(debit.reason || 'debit_failed');
      await economy().credit(recipient, amount, 'treasury_payout');
      return { recipient, amount };
    }
    case 'dedicate_landmark': {
      // Cosmetic action — recorded on the event log only. The plan has
      // a dynamic landmark table in mind; until that lands, we just log.
      return { parcel_id: params.parcel_id, name: params.name };
    }
  }
}

export function resetGovernanceForTesting() {
  stmts = null;
  runtimeTradingFeeBps = null;
}
