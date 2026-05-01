import { BUILDINGS, BuildingType, LAND_COST } from '@gamestu/shared';
import { getRawDb } from './db';
import { WORLD_TREASURY_ID } from './economy';

export interface NetWorthRow {
  id: string;
  name: string;
  balance: number;
  reputation: number;
  parcels: number;
  buildings: number;
  land_value: number;
  property_value: number;
  net_worth: number;
}

export type LeaderboardSort = 'net_worth' | 'balance' | 'land' | 'properties' | 'reputation';

const VALID_SORT: Record<LeaderboardSort, true> = {
  net_worth: true,
  balance: true,
  land: true,
  properties: true,
  reputation: true,
};

export function isValidSort(s: string): s is LeaderboardSort {
  return Object.prototype.hasOwnProperty.call(VALID_SORT, s);
}

interface PlayerAggRow {
  id: string;
  name: string;
  credits: number;
  reputation: number;
  parcel_count: number;
  building_types: string | null; // comma-separated building_type for each owned built parcel
}

let aggStmt: import('better-sqlite3').Statement | null = null;

function getAggStmt() {
  if (aggStmt) return aggStmt;
  aggStmt = getRawDb().prepare(`
    SELECT
      p.id,
      p.name,
      p.credits,
      p.reputation,
      COALESCE(parc.parcel_count, 0) AS parcel_count,
      bld.building_types AS building_types
    FROM players p
    LEFT JOIN (
      SELECT owner_id, COUNT(*) AS parcel_count
      FROM parcels
      WHERE owner_id IS NOT NULL
      GROUP BY owner_id
    ) parc ON parc.owner_id = p.id
    LEFT JOIN (
      SELECT owner_id, GROUP_CONCAT(building_type) AS building_types
      FROM parcels
      WHERE owner_id IS NOT NULL AND building_type IS NOT NULL
      GROUP BY owner_id
    ) bld ON bld.owner_id = p.id
    WHERE p.id != ?
  `);
  return aggStmt;
}

function rowToNetWorth(r: PlayerAggRow): NetWorthRow {
  let property_value = 0;
  let buildings = 0;
  if (r.building_types) {
    for (const t of r.building_types.split(',')) {
      const spec = BUILDINGS[t as BuildingType];
      if (spec) {
        property_value += spec.cost;
        buildings += 1;
      }
    }
  }
  const land_value = r.parcel_count * LAND_COST;
  return {
    id: r.id,
    name: r.name,
    balance: r.credits,
    reputation: r.reputation,
    parcels: r.parcel_count,
    buildings,
    land_value,
    property_value,
    net_worth: r.credits + land_value + property_value,
  };
}

/** Net worth for a single player. */
export function getNetWorth(playerId: string): NetWorthRow | null {
  const row = getRawDb().prepare(`
    SELECT
      p.id,
      p.name,
      p.credits,
      p.reputation,
      COALESCE(parc.parcel_count, 0) AS parcel_count,
      bld.building_types AS building_types
    FROM players p
    LEFT JOIN (
      SELECT owner_id, COUNT(*) AS parcel_count FROM parcels
      WHERE owner_id IS NOT NULL GROUP BY owner_id
    ) parc ON parc.owner_id = p.id
    LEFT JOIN (
      SELECT owner_id, GROUP_CONCAT(building_type) AS building_types FROM parcels
      WHERE owner_id IS NOT NULL AND building_type IS NOT NULL GROUP BY owner_id
    ) bld ON bld.owner_id = p.id
    WHERE p.id = ?
  `).get(playerId) as PlayerAggRow | undefined;
  return row ? rowToNetWorth(row) : null;
}

/** Top-N leaderboard sorted by the requested metric. */
export function getLeaderboard(
  sort: LeaderboardSort = 'net_worth',
  limit = 50,
): NetWorthRow[] {
  const rows = getAggStmt().all(WORLD_TREASURY_ID) as PlayerAggRow[];
  const enriched = rows.map(rowToNetWorth);
  const cmp: Record<LeaderboardSort, (a: NetWorthRow, b: NetWorthRow) => number> = {
    net_worth: (a, b) => b.net_worth - a.net_worth,
    balance:   (a, b) => b.balance - a.balance,
    land:      (a, b) => b.parcels - a.parcels,
    properties:(a, b) => b.buildings - a.buildings,
    reputation:(a, b) => b.reputation - a.reputation,
  };
  enriched.sort(cmp[sort]);
  return enriched.slice(0, limit);
}

/** Test-only — clear cached prepared statement (for fresh-DB test runs). */
export function resetLeaderboardForTesting() {
  aggStmt = null;
}
