/**
 * Rank lookup + cap helpers.
 *
 * Phase 2 (2026-05-20): the rank system itself ships in Phase 4 — players
 * are promoted from Bronze → Silver → Gold → Platinum → Diamond when
 * lifetime luxury burn crosses each threshold. Until then, every player
 * defaults to Bronze. These helpers are the place that read the rank,
 * so Phase 4 only has to populate `players.rank` and update one helper.
 */

import {
  type Tier,
  IN_GAME_AGENT_CAP_BY_RANK,
  EXTERNAL_AGENT_CAP_BY_RANK,
  LAND_CAP_BY_RANK,
  MARKETPLACE_FEE_BPS_BY_RANK,
  RANK_PRODUCTION_BONUS,
} from '@gamestu/shared';

/**
 * Resolve a player's current rank. Phase 4 will compute this from
 * `players.lifetime_luxury_burned`; for now everyone is Bronze.
 *
 * Accepts a player id (wallet or agent) but only wallet-owned players
 * have a real rank — agents inherit their owner's rank for cap math.
 */
export function rankFor(_playerId: string): Tier {
  // TODO Phase 4: read players.rank from DB
  return 'bronze';
}

/** Max in-game agents (purchased + assigned) for the given player. */
export function inGameAgentCapFor(playerId: string): number {
  return IN_GAME_AGENT_CAP_BY_RANK[rankFor(playerId)];
}

/** Max external API-driven agents for the given player. */
export function externalAgentCapFor(playerId: string): number {
  return EXTERNAL_AGENT_CAP_BY_RANK[rankFor(playerId)];
}

/** Max land parcels the player can own. */
export function landCapFor(playerId: string): number {
  return LAND_CAP_BY_RANK[rankFor(playerId)];
}

/** Marketplace fee in basis points that the player pays as taker. */
export function marketplaceFeeBpsFor(playerId: string): number {
  return MARKETPLACE_FEE_BPS_BY_RANK[rankFor(playerId)];
}

/** Multiplicative production bonus from rank (0 below Platinum). */
export function productionBonusFor(playerId: string): number {
  return RANK_PRODUCTION_BONUS[rankFor(playerId)];
}
