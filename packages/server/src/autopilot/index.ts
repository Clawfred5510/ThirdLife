/**
 * Server-side autopilot.
 *
 * Phase 0 rewrite (2026-05-20): replaces the personality/strategy weighted
 * dispatch with a clean role-based one. Each agent has a `role` (work /
 * produce / craft) that determines what they do each income tick.
 *
 *   - work    : Stand at workplace (NPC building or player-owned). Will
 *               earn a flat WORK_WAGE_AMETA_PER_TICK in Phase 4. Today no
 *               economic effect — only positioning.
 *   - produce : Stand at workplace, produce that building's resource.
 *               Phase 0 keeps the legacy `doWork` bridge so existing
 *               production keeps flowing; Phase 1 replaces with the
 *               tier × (base + agents) formula.
 *   - craft   : Stand at workplace. Crafting logic ships in Phase 3.
 *
 * Strategy presets (aggressive/balanced/conservative) are gone — they
 * affected only the deprecated trader/builder personality routines that
 * the role enum collapses. External agents will handle their own strategy
 * via the API in Phase 5.
 */

import {
  getAllAgents,
  getPlayerResources,
  getPlayerParcels,
  getAllParcels,
  workProduce,
  buyLand,
  setBuildingType,
  updateBusiness,
  addEvent,
  savePlayerPosition,
  type ParcelRow,
} from '../db';
import {
  BUILDINGS,
  BuildingType,
  ResourceType,
  TICK_PRODUCTION,
  AgentRole,
  parcelWorldPos,
} from '@gamestu/shared';
import { recordGdp, getWorldTick } from '../world';

interface AgentRow {
  id: string;
  name: string;
  role: string;
  is_external: number;
  autopilot_enabled: number;
  last_autopilot_tick: number;
  workplace_parcel_id: number | null;
  job: string | null;
}

export interface AgentMove {
  agentId: string;
  x: number;
  y: number;
  z: number;
}

// Spawn plaza — where unemployed agents stand. Mirrors the human spawn
// position so they look like a welcoming crowd at the origin.
const SPAWN_X = 0;
const SPAWN_Y = 0;
const SPAWN_Z = -80;

/** Workplace anchor: parcel centre offset 12u south of the building, so
 *  the agent is visibly out in front of the structure rather than embedded
 *  in the wall. Same formula every tick → no jitter. */
function parcelDoor(parcel: ParcelRow): { x: number; y: number; z: number } {
  const { x, z } = parcelWorldPos(parcel.grid_x, parcel.grid_y);
  return { x, y: 0, z: z - 12 };
}

/** Deterministic per-agent offset around the spawn plaza so dozens of
 *  unemployed agents don't visually pile up at exactly (0, 0, -80).
 *  Same hash for the same agent across ticks → stable position. */
function spawnSpreadFor(agentId: string): { x: number; y: number; z: number } {
  const h = simpleHash(agentId);
  const angle = (h % 360) * (Math.PI / 180);
  const radius = 6 + ((h >>> 8) % 24); // 6–30 units from spawn
  return {
    x: SPAWN_X + Math.cos(angle) * radius,
    y: SPAWN_Y,
    z: SPAWN_Z + Math.sin(angle) * radius,
  };
}

/**
 * Run all registered agents' autopilot routines. Called from the GameRoom
 * income tick (every TICK_LENGTH_MS). Catches per-agent exceptions so one
 * bad agent can't take down the whole tick. External agents are skipped
 * entirely — their actions arrive via REST, not the autopilot.
 */
export function runAutopilotPass(): AgentMove[] {
  const agents = getAllAgents().filter(
    (a) => a.autopilot_enabled === 1 && a.is_external !== 1,
  ) as AgentRow[];
  // Snapshot parcels once per tick so per-agent routines don't each scan
  // the full grid. Indexed by id for O(1) workplace lookups.
  const parcelMap = new Map<number, ParcelRow>();
  for (const p of getAllParcels()) parcelMap.set(p.id, p);

  const moves: AgentMove[] = [];
  for (const agent of agents) {
    try {
      const move = runOne(agent, parcelMap);
      if (move) {
        savePlayerPosition(agent.id, move.x, move.y, move.z);
        moves.push({ agentId: agent.id, x: move.x, y: move.y, z: move.z });
      }
    } catch (err) {
      console.error(`[autopilot] ${agent.name} (${agent.role}) failed:`, (err as Error).message);
    }
  }
  return moves;
}

function runOne(agent: AgentRow, parcels: Map<number, ParcelRow>): { x: number; y: number; z: number } | null {
  const workplace = agent.workplace_parcel_id != null
    ? parcels.get(agent.workplace_parcel_id) ?? null
    : null;
  const role = (agent.role as AgentRole) ?? 'work';

  switch (role) {
    case 'work':    return runWork(agent, workplace);
    case 'produce': return runProduce(agent, workplace);
    case 'craft':   return runCraft(agent, workplace);
    default:        return runWork(agent, workplace);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Role routines
// ──────────────────────────────────────────────────────────────────────

/** Work role: stand at the workplace; earn WORK_WAGE_AMETA_PER_TICK.
 *  Phase 0 keeps positioning only — wage payout lands in Phase 4 when the
 *  pricing module's wage constant is wired into the GameRoom tick. */
function runWork(agent: AgentRow, workplace: ParcelRow | null): { x: number; y: number; z: number } | null {
  return workplace ? parcelDoor(workplace) : spawnSpreadFor(agent.id);
}

/** Produce role: stand at the workplace and generate the building's resource.
 *  Phase 0 bridge: routes through the legacy `doWork` helper so production
 *  keeps flowing for existing agents. Phase 1 replaces this with the new
 *  tier × (base + agents) × energy formula in the GameRoom tick. */
function runProduce(agent: AgentRow, workplace: ParcelRow | null): { x: number; y: number; z: number } | null {
  const produced = doWork(agent.id, workplace);
  if (produced.creditsEarned > 0 || produced.anyProduced) {
    addEvent('autopilot', agent.id, {
      role: 'produce', action: 'tick',
      earned: produced.creditsEarned, produced: produced.summary,
      workplace: workplace?.id ?? null,
    }, 'minor');
  }
  return workplace ? parcelDoor(workplace) : spawnSpreadFor(agent.id);
}

/** Craft role: stand at the workplace and consume input → produce named
 *  luxury items. Phase 0 stub; Phase 3 implements the consumption + item
 *  minting logic. Visually identical to produce for now. */
function runCraft(agent: AgentRow, workplace: ParcelRow | null): { x: number; y: number; z: number } | null {
  return workplace ? parcelDoor(workplace) : spawnSpreadFor(agent.id);
}

// ──────────────────────────────────────────────────────────────────────
// Phase 0 bridge: legacy production helper
// ──────────────────────────────────────────────────────────────────────

/** Legacy production path. Kept for one phase as a bridge so role=produce
 *  agents keep producing under the old per-building flat rate while the
 *  tier-based formula is being built. Phase 1 will delete this entirely. */
function doWork(agentId: string, workplace: ParcelRow | null): {
  creditsEarned: number;
  produced: Partial<Record<ResourceType, number>>;
  anyProduced: boolean;
  summary: string;
} {
  const targets: ParcelRow[] = workplace
    ? [workplace]
    : (getPlayerParcels(agentId) as ParcelRow[]);
  let creditsEarned = 0;
  const produced: Partial<Record<ResourceType, number>> = {};
  const resources = getPlayerResources(agentId);

  for (const p of targets) {
    const buildingType = (p as { building_type?: string }).building_type;
    if (!buildingType) continue;
    const spec = BUILDINGS[buildingType as BuildingType];
    if (!spec) continue;
    if (spec.produces && spec.amount) {
      resources[spec.produces] += spec.amount;
      produced[spec.produces] = (produced[spec.produces] ?? 0) + spec.amount;
    }
    // Income only applies to owned parcels — a freelancer at someone
    // else's parcel produces resources but doesn't collect the building's
    // passive income (that belongs to the parcel owner).
    if (!workplace && spec.income > 0) creditsEarned += spec.income;
  }

  if (creditsEarned > 0 || Object.keys(produced).length > 0) {
    workProduce(agentId, creditsEarned, resources);
    if (creditsEarned > 0) recordGdp(creditsEarned);
  }
  void TICK_PRODUCTION; // legacy constant kept until Phase 1 finishes

  return {
    creditsEarned,
    produced,
    anyProduced: Object.keys(produced).length > 0,
    summary: Object.entries(produced).map(([k, v]) => `${v} ${k}`).join(', '),
  };
}

function simpleHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

// Suppress unused-import lint when these helpers are referenced from
// external callers but not directly here yet.
void setBuildingType;
void updateBusiness;
void buyLand;
void getWorldTick;
