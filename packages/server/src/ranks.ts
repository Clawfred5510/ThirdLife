/**
 * Rank lookup + cap helpers.
 *
 * Ranks are driven by lifetime luxury burn (see RANK_BURN_THRESHOLD in
 * @gamestu/shared). Players are promoted at burn time inside
 * backend.burnLuxuryItems, which writes the current rank to
 * `players.rank`. These helpers read that column and fall back to Bronze
 * for any actor that has never burned but is interacting with rank-gated
 * mechanics (e.g. an in-game agent's owner inherits the wallet's rank).
 */

import {
  type Tier,
  IN_GAME_AGENT_CAP_BY_RANK,
  EXTERNAL_AGENT_CAP_BY_RANK,
  LAND_CAP_BY_RANK,
  MARKETPLACE_FEE_BPS_BY_RANK,
  TIER_NAMES,
} from '@gamestu/shared';
import { getPlayerRank, getAgentById } from './db';

const VALID_RANKS: ReadonlySet<string> = new Set(TIER_NAMES);

/**
 * Resolve a player's current rank.
 *
 * Wallet ids (0x…) → read players.rank directly.
 * Agent ids (wallet:agent:…) → resolve to the owning wallet's rank so
 * an in-game agent's actions inherit the owner's caps + fee tier.
 *
 * Defaults to Bronze for any actor with no recorded rank (e.g. a new
 * wallet that hasn't burned yet, or a legacy agent).
 */
export function rankFor(playerId: string): Tier {
  let rank = getPlayerRank(playerId);
  if (!rank) {
    // Agent? Walk up to the owning wallet.
    const agent = getAgentById(playerId);
    if (agent?.owner_wallet) {
      rank = getPlayerRank(agent.owner_wallet);
    }
  }
  if (rank && VALID_RANKS.has(rank)) return rank as Tier;
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

// productionBonusFor() intentionally removed — owner override 2026-05-20:
// rank gives caps + access only, no passive production multiplier.
// Production = building_tier × (1 + agents) regardless of rank.
