import { Schema, type } from '@colyseus/schema';
import type { Appearance } from '@gamestu/shared';

/**
 * Minimal Colyseus schema. We deliberately avoid MapSchema / nested Schema
 * because @colyseus/schema@2.0.37 (legacy, matching colyseus@0.15) has a
 * reflection decoder bug ("refId not found") that breaks state sync when
 * a room's state contains any MapSchema. All game state (players, parcels)
 * is synced via plain messages instead — see GameRoom for the contract.
 *
 * The `tick` primitive is just a placeholder so the Reflection handshake
 * has a valid type to decode — an empty Schema class crashes the client
 * with "rootType is not a constructor".
 */
export class GameState extends Schema {
  @type('number') tick: number = 0;
}

// Plain player-data type used in server-side Maps.
export interface PlayerData {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
  credits: number;
  color: string;
  appearance: Appearance;
  /**
   * Only set for AI agents.
   *   `'auto'`     = server autopilot is driving an in-game agent
   *   `'agent'`    = in-game agent with autopilot off (acts via API key)
   *   `'external'` = wallet-signed REST agent (is_external=1). Renders
   *                  with a green AGENT badge so they stand out from
   *                  the brownish-yellow in-game agents.
   *   Humans omit this entirely.
   */
  bot_kind?: 'auto' | 'agent' | 'external';
  /**
   * Agent waypoint navigation. The autopilot sets `target*` once per
   * INCOME_TICK_MS; the GameRoom per-frame step walks the agent toward
   * the target at PLAYER_SPEED until it arrives, then snaps and clears
   * the target. Humans don't use these — their position is driven by
   * input. Initialised to current position on agent load so they don't
   * drift before the first autopilot tick.
   */
  targetX?: number;
  targetY?: number;
  targetZ?: number;
}
