/**
 * Multi-floor sub-units (Phase C — legacy).
 *
 * @deprecated Phase 0 (2026-05-20): the spec's new building model is one
 * building = one tier = one production output (no sub-units). This module
 * is kept running for now so existing players don't lose their sub-unit
 * positions; Phase 1 will fully retire it once the tier-based production
 * formula replaces the per-unit income tick.
 *
 * Original design:
 *   Apartment → 18 studio units (3 floors × 6).  Each pays 5 $AMETA/tick.
 *   Office    → 12 office units (3 floors × 4).  Each pays 8 $AMETA/tick.
 *   Penthouse on top floor of either building (last unit_index of last
 *             floor) pays a 50% premium.
 *
 * When an apartment / office is built, generateUnitsForParcel() seeds the
 * 12 or 18 rows, all owned by the parcel owner with list_price = NULL
 * (not for sale by default).
 */

import type { Statement } from 'better-sqlite3';
import { getRawDb } from '../db';
import { economy } from '../economy';
import { addEvent } from '../db';
import { recordGdp } from '../world';

export type UnitType = 'studio' | 'office' | 'penthouse';

export interface PropertyRow {
  id: number;
  parcel_id: number;
  unit_type: UnitType;
  floor: number;
  unit_index: number;
  owner_id: string | null;
  list_price: number | null;
  income_per_tick: number;
}

interface UnitSpec { type: UnitType; floors: number; perFloor: number; income: number; }

const APARTMENT_SPEC: UnitSpec = { type: 'studio', floors: 3, perFloor: 6, income: 5 };
const OFFICE_SPEC:    UnitSpec = { type: 'office', floors: 3, perFloor: 4, income: 8 };

const SPEC_BY_BUILDING: Record<string, UnitSpec | undefined> = {
  apartment: APARTMENT_SPEC,
  office: OFFICE_SPEC,
};

/** True if this building type generates sub-units. */
export function buildingHasUnits(buildingType: string): boolean {
  return Boolean(SPEC_BY_BUILDING[buildingType]);
}

/** Penthouse premium: top-floor, last-unit pays 1.5× the floor income. */
function isPenthouse(spec: UnitSpec, floor: number, idx: number): boolean {
  return floor === spec.floors && idx === spec.perFloor;
}

let stmts: {
  insertUnit: Statement;
  countByParcel: Statement;
  byParcel: Statement;
  byParcelForSale: Statement;
  byOwner: Statement;
  forSaleAll: Statement;
  byId: Statement;
  setListPrice: Statement;
  setOwner: Statement;
  unitsTickIncome: Statement;
} | null = null;

function getStmts() {
  if (stmts) return stmts;
  const db = getRawDb();
  stmts = {
    insertUnit: db.prepare(`
      INSERT INTO properties (parcel_id, unit_type, floor, unit_index, owner_id, list_price, income_per_tick)
      VALUES (?, ?, ?, ?, ?, NULL, ?)
    `),
    countByParcel: db.prepare(`SELECT COUNT(*) AS n FROM properties WHERE parcel_id = ?`),
    byParcel:      db.prepare(`SELECT * FROM properties WHERE parcel_id = ? ORDER BY floor, unit_index`),
    byParcelForSale: db.prepare(`SELECT * FROM properties WHERE parcel_id = ? AND list_price IS NOT NULL ORDER BY list_price ASC LIMIT 200`),
    byOwner:       db.prepare(`SELECT * FROM properties WHERE owner_id = ? ORDER BY parcel_id, floor, unit_index`),
    forSaleAll:    db.prepare(`SELECT * FROM properties WHERE list_price IS NOT NULL ORDER BY list_price ASC LIMIT 200`),
    byId:          db.prepare(`SELECT * FROM properties WHERE id = ?`),
    setListPrice:  db.prepare(`UPDATE properties SET list_price = ? WHERE id = ?`),
    setOwner:      db.prepare(`UPDATE properties SET owner_id = ?, list_price = NULL WHERE id = ?`),
    // Tick income: aggregate income_per_tick by owner across all owned
    // sub-units. The per-owner total is added to credits in one row
    // each tick.
    unitsTickIncome: db.prepare(`
      SELECT owner_id, SUM(income_per_tick) AS total FROM properties
      WHERE owner_id IS NOT NULL GROUP BY owner_id
    `),
  };
  return stmts;
}

/** Seed sub-units for a freshly-built apartment/office. No-op for other
 *  building types or when units already exist for that parcel.
 */
export function generateUnitsForParcel(parcelId: number, buildingType: string, ownerId: string): number {
  const spec = SPEC_BY_BUILDING[buildingType];
  if (!spec) return 0;
  const s = getStmts();
  const existing = (s.countByParcel.get(parcelId) as { n: number }).n;
  if (existing > 0) return 0;

  let created = 0;
  const tx = getRawDb().transaction(() => {
    for (let floor = 1; floor <= spec.floors; floor++) {
      for (let idx = 1; idx <= spec.perFloor; idx++) {
        const isPent = isPenthouse(spec, floor, idx);
        const unitType: UnitType = isPent ? 'penthouse' : spec.type;
        const income = isPent ? Math.floor(spec.income * 1.5) : spec.income;
        s.insertUnit.run(parcelId, unitType, floor, idx, ownerId, income);
        created += 1;
      }
    }
  });
  tx();
  return created;
}

export function getPropertiesForParcel(parcelId: number, forSaleOnly = false): PropertyRow[] {
  const s = getStmts();
  const rows = forSaleOnly ? s.byParcelForSale.all(parcelId) : s.byParcel.all(parcelId);
  return rows as PropertyRow[];
}

export function getPropertiesForOwner(ownerId: string): PropertyRow[] {
  return getStmts().byOwner.all(ownerId) as PropertyRow[];
}

export function getAllForSale(): PropertyRow[] {
  return getStmts().forSaleAll.all() as PropertyRow[];
}

export function getProperty(id: number): PropertyRow | null {
  return (getStmts().byId.get(id) as PropertyRow | undefined) ?? null;
}

export function listProperty(ownerId: string, propertyId: number, price: number): { ok: boolean; reason?: string } {
  if (!Number.isInteger(price) || price <= 0) return { ok: false, reason: 'invalid_price' };
  const p = getProperty(propertyId);
  if (!p) return { ok: false, reason: 'not_found' };
  if (p.owner_id !== ownerId) return { ok: false, reason: 'not_owner' };
  getStmts().setListPrice.run(price, propertyId);
  addEvent('property_listed', ownerId, { property: propertyId, price }, 'normal');
  return { ok: true };
}

export function unlistProperty(ownerId: string, propertyId: number): { ok: boolean; reason?: string } {
  const p = getProperty(propertyId);
  if (!p) return { ok: false, reason: 'not_found' };
  if (p.owner_id !== ownerId) return { ok: false, reason: 'not_owner' };
  if (p.list_price === null) return { ok: false, reason: 'not_listed' };
  getStmts().setListPrice.run(null, propertyId);
  addEvent('property_unlisted', ownerId, { property: propertyId }, 'minor');
  return { ok: true };
}

export async function buyProperty(buyerId: string, propertyId: number): Promise<{ ok: boolean; reason?: string; price?: number }> {
  const p = getProperty(propertyId);
  if (!p) return { ok: false, reason: 'not_found' };
  if (p.list_price === null) return { ok: false, reason: 'not_listed' };
  if (p.owner_id === buyerId) return { ok: false, reason: 'self_buy' };
  if (p.owner_id === null) return { ok: false, reason: 'no_seller' };

  // Transfer through economy() so the trading fee applies and the
  // on-chain swap path works without changing call sites later.
  const transfer = await economy().transfer(buyerId, p.owner_id, p.list_price, 'property_buy');
  if (!transfer.ok) return { ok: false, reason: transfer.reason };

  getStmts().setOwner.run(buyerId, propertyId);
  addEvent('property_sold', buyerId, {
    property: propertyId, parcel: p.parcel_id, floor: p.floor, unit_type: p.unit_type,
    price: p.list_price, fee: transfer.fee, seller: p.owner_id,
  }, 'major');
  recordGdp(p.list_price);
  return { ok: true, price: p.list_price };
}

/**
 * Per-tick income for sub-unit owners. Returns total minted credits
 * so the GDP accumulator can include it.
 */
export function tickPropertyIncome(): number {
  const s = getStmts();
  const rows = s.unitsTickIncome.all() as Array<{ owner_id: string; total: number }>;
  if (rows.length === 0) return 0;

  const db = getRawDb();
  let totalMinted = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      if (row.total <= 0) continue;
      db.prepare('UPDATE players SET credits = credits + ? WHERE id = ?').run(row.total, row.owner_id);
      totalMinted += row.total;
    }
  });
  tx();
  if (totalMinted > 0) recordGdp(totalMinted);
  return totalMinted;
}

/**
 * Backfill: any apartment/office parcel that doesn't yet have sub-units
 * gets them retro-created, owned by the parcel owner. Runs once at
 * startup for the existing world.
 */
export function backfillSubUnits(): { processed: number; created: number } {
  const db = getRawDb();
  const buildingsWithUnits = Object.keys(SPEC_BY_BUILDING);
  const placeholders = buildingsWithUnits.map(() => '?').join(',');
  const parcels = db.prepare(
    `SELECT id, owner_id, building_type FROM parcels
     WHERE owner_id IS NOT NULL AND building_type IN (${placeholders})`,
  ).all(...buildingsWithUnits) as Array<{ id: number; owner_id: string; building_type: string }>;
  let created = 0;
  for (const p of parcels) {
    created += generateUnitsForParcel(p.id, p.building_type, p.owner_id);
  }
  return { processed: parcels.length, created };
}

export function resetPropertyStatementsForTesting() {
  stmts = null;
}
