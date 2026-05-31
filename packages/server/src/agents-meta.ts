import { BUILDINGS, BuildingType } from '@gamestu/shared';
import type { ParcelRow } from './db';

/**
 * Level is a simple net-worth tier. Matches the small `9 / 10 / 12`
 * numbers next to leaderboard names on the canonical site (rough
 * exponential ladder).
 */
export function computeLevel(netWorth: number): number {
  if (netWorth <= 0) return 1;
  // log2 ladder rooted at 1k AMETA; clamped to 1..50
  const lvl = 1 + Math.floor(Math.log2(Math.max(1, netWorth / 1000)));
  return Math.max(1, Math.min(50, lvl));
}

/**
 * Job is the agent's most-owned production-building type. Falls back
 * to "Unemployed" if no income/production buildings.
 */
const JOB_LABELS: Partial<Record<BuildingType, string>> = {
  farm: 'Farmer',
  ranch: 'Rancher',
  hydroponic_tower: 'Hydroponic Engineer',
  vertical_farm_complex: 'Vertical-Farm Operator',
  synthetic_protein_lab: 'Protein Scientist',
  mine: 'Miner',
  blacksmith: 'Forgeman',
  refinery: 'Refiner',
  composite_plant: 'Composite Engineer',
  chip_manufacturing: 'Chip Fabricator',
  factory: 'Industrialist',
  wind_farm: 'Wind Technician',
  solar_farm: 'Solar Technician',
  nuclear_plant: 'Nuclear Engineer',
  cold_fusion_facility: 'Fusion Scientist',
  apartment: 'Landlord',
  house: 'Landlord',
  duplex: 'Landlord',
  villa: 'Landlord',
  mansion: 'Landlord',
  office: 'Executive',
  market: 'Merchant',
  bank: 'Banker',
  town_hall: 'Civic Leader',
  gala_hall: 'Civic Leader',
};

export function computeJob(parcels: ParcelRow[]): string {
  const counts = new Map<BuildingType, number>();
  for (const p of parcels) {
    const bt = (p as { building_type?: string }).building_type as BuildingType | undefined;
    if (!bt || !BUILDINGS[bt]) continue;
    counts.set(bt, (counts.get(bt) ?? 0) + 1);
  }
  if (counts.size === 0) return 'Unemployed';
  let bestType: BuildingType | null = null;
  let bestCount = 0;
  for (const [t, n] of counts) {
    if (n > bestCount) { bestType = t; bestCount = n; }
  }
  return bestType ? (JOB_LABELS[bestType] ?? bestType) : 'Unemployed';
}
