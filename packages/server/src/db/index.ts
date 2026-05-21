import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';
import {
  LAND_COST, GRID_COLS, GRID_ROWS, RESERVED_PARCEL_IDS, rankFromLifetimeBurn,
  PROPERTY_FEE_BPS, BPS_DENOMINATOR,
} from '@gamestu/shared';
import { WORLD_TREASURY_ID } from '../economy/IEconomy';

/** Helper: 1% property fee on a given gross. Used inside the DB
 *  transaction so the treasury credit settles atomically with the cost
 *  deduction. */
function propertyFee(gross: number): number {
  return Math.floor((gross * PROPERTY_FEE_BPS) / BPS_DENOMINATOR);
}

/** Parse a JSON object column safely. Returns {} on null / malformed input. */
function safeJsonObj(s: string): Record<string, number> {
  try {
    const parsed = JSON.parse(s);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch { return {}; }
}

const RESERVED_SET = new Set<number>(RESERVED_PARCEL_IDS);

// ── Types ──────────────────────────────────────────────────────────────────

export interface PlayerRow {
  id: string;
  name: string;
  credits: number;
  reputation: number;
  x: number;
  y: number;
  z: number;
  last_login: string | null;
  tutorial_done: number;
  appearance: string | null;
}

export interface ParcelRow {
  id: number;
  grid_x: number;
  grid_y: number;
  owner_id: string | null;
  business_name: string | null;
  business_type: string | null;
  color: string;
  height: number;
  claimed_at: string | null;
}

export interface BusinessUpdate {
  name?: string;
  type?: string;
  color?: string;
  height?: number;
}

export interface AgentRow {
  id: string;
  name: string;
  /** @deprecated Phase 0: superseded by `role`. Kept for legacy reads. */
  personality: string;
  /** @deprecated Phase 0: strategy presets removed. Kept for legacy reads. */
  strategy: string;
  /** Phase 0 role enum: 'work' | 'produce' | 'craft'. Default 'work'. */
  role: string;
  /** Phase 0: 1 if this is an external API-driven agent, 0 for in-game. */
  is_external: number;
  /** Phase 2: tick at which the agent went dormant from starvation, or null. */
  dormant_at_tick: number | null;
  /** Phase 2: consecutive ticks the agent has been starved. */
  starvation_ticks: number;
  /** Phase 5: external agent's allocated $AMETA trading budget. */
  trading_budget_ameta: number | null;
  autopilot_enabled: number;
  last_autopilot_tick: number;
  created_at: string;
  owner_wallet: string | null;
  job: string | null;
  workplace_parcel_id: number | null;
  appearance: string | null;
}

// ── SQLite vs In-Memory fallback ───────────────────────────────────────────

interface DBBackend {
  getOrCreatePlayer(id: string, name: string): PlayerRow;
  savePlayerPosition(id: string, x: number, y: number, z: number): void;
  updatePlayerCredits(id: string, credits: number): void;
  getPlayerCredits(id: string): number;
  isTutorialDone(playerId: string): boolean;
  markTutorialDone(playerId: string): void;
  seedParcels(): void;
  claimParcel(parcelId: number, playerId: string): boolean;
  updateBusiness(parcelId: number, playerId: string, data: BusinessUpdate): boolean;
  getAllParcels(): ParcelRow[];
  getParcelOwner(parcelId: number): string | null;
  wipeParcels(): void;
  wipePlayerParcels(id: string): number;
  getAllPlayers(): PlayerRow[];
  deletePlayer(id: string): boolean;
  savePlayerAppearance(id: string, appearanceJson: string): void;
  getPlayerResources(id: string): { food: number; materials: number; energy: number; luxury: number };
  updatePlayerResources(id: string, resources: { food: number; materials: number; energy: number; luxury: number }): void;
  setBuildingType(parcelId: number, buildingType: string): void;
  getPlayerParcels(playerId: string): ParcelRow[];
  addEvent(type: string, playerId: string | null, data: Record<string, unknown>, severity?: string): void;
  getEvents(limit?: number, opts?: { severity?: string; type?: string; playerId?: string }): Array<{ id: number; type: string; player_id: string | null; data: string; severity: string; created_at: string }>;
  registerAgent(
    id: string, name: string, personality: string, strategy: string,
    apiKey: string, ownerWallet: string | null,
    job: string | null, workplaceParcelId: number | null, appearanceJson: string | null,
  ): void;
  getAgentByApiKey(apiKey: string): { id: string; name: string } | null;
  getAllAgents(): Array<AgentRow>;
  /** Agents owned by a wallet (the unified replacement for wallet_bots). */
  getAgentsByWallet(walletAddress: string): Array<AgentRow>;
  /** Single agent's record, including its owning wallet (or null for legacy unowned agents). */
  getAgentById(agentId: string): AgentRow | null;
  countAgentsByWallet(walletAddress: string): number;
  /** Count only in-game (is_external=0) or only external (=1) agents. */
  countAgentsByWalletAndKind(walletAddress: string, isExternal: 0 | 1): number;
  /** Phase 2 starvation state: update the agent's starvation_ticks and
   *  dormant_at_tick. Pass `dormantAtTick = null` to revive. */
  setAgentStarvation(agentId: string, starvationTicks: number, dormantAtTick: number | null): void;
  /** Phase 2 role assignment: 'work' | 'produce' | 'craft'. */
  setAgentRole(agentId: string, role: string): void;
  /** Phase 3 luxury items. */
  getPlayerItems(playerId: string): Record<string, number>;
  addPlayerItems(playerId: string, itemKind: string, delta: number): number;
  /** Returns the new lifetime burn total and the rank state (Phase 4
   *  promotion is computed inside the transaction so the DB is the source
   *  of truth — rankBefore/After lets the caller detect promotions). */
  burnLuxuryItems(
    playerId: string, itemKind: string, quantity: number, burnValue: number,
  ): {
    ok: boolean; reason?: string;
    lifetime?: number; gained?: number;
    rankBefore?: string | null; rankAfter?: string | null;
  };
  /** Cumulative luxury burned. 0 if the player has never burned. */
  getLifetimeLuxuryBurned(playerId: string): number;
  /** UI Overhaul: rank is now driven by lifetime luxury *earned*, not
   *  only luxury *burned via items*. This helper folds production luxury
   *  (passive housing/civic emission, legacy luxury rates, offline-accrual
   *  luxury replay) into the same `lifetime_luxury_burned` column and
   *  recomputes the rank atomically. Returns the new lifetime + rank
   *  before/after so the caller can detect promotion. */
  bumpLifetimeLuxury(
    playerId: string, amount: number,
  ): { lifetime: number; rankBefore: string | null; rankAfter: string | null };
  /** Current rank, or null if the player has never burned. */
  getPlayerRank(playerId: string): string | null;
  /** Force-set a player's rank (used by migration paths; usually computed
   *  by burnLuxuryItems instead). */
  setPlayerRank(playerId: string, rank: string | null): void;
  /** Phase 6 offline accrual: last world tick at which this player's
   *  state was settled. 0 = never. */
  getLastSettledTick(playerId: string): number;
  setLastSettledTick(playerId: string, tick: number): void;
  /** UI Overhaul: per-agent lifetime stats for the 3D click popup. */
  bumpAgentLifetimeStats(
    agentId: string,
    delta: { wages?: number; resources?: Record<string, number>; items?: Record<string, number> },
  ): void;
  getAgentLifetimeStats(agentId: string): {
    wages: number;
    resources: Record<string, number>;
    items: Record<string, number>;
  };
  /** Reassign the workplace of an agent (owner-only enforcement at the API layer). */
  setAgentWorkplace(agentId: string, parcelId: number | null): void;
  /** Reputation tick: every owned shop consumes 1 luxury, owner gains
   *  +1 reputation per consumed unit. Returns a per-owner summary. */
  tickReputation(): Array<{ owner_id: string; consumed: number }>;
  playerExists(id: string): boolean;
  transferCredits(fromId: string, toId: string, amount: number): { ok: boolean; reason?: string };
  workProduce(
    id: string,
    creditsEarned: number,
    newResources: { food: number; materials: number; energy: number; luxury: number },
  ): { credits: number };
  buyLand(id: string, parcelId: number): { ok: boolean; reason?: string; credits?: number };
  /** Claim a parcel AND place a building on it in one transaction — charges
   *  LAND_COST + the building's cost atomically. Also sets the business
   *  name/type. */
  claimAndBuild(
    id: string,
    parcelId: number,
    buildingType: string,
    buildingCost: number,
    buildingLabel: string,
    materialCost?: number,
  ): { ok: boolean; reason?: string; credits?: number };
  /** All owned parcels with a building set — single scan for the income tick. */
  getOwnedBuiltParcels(): Array<{ id: number; owner_id: string; building_type: string }>;
  // Wallet auth
  createAuthNonce(address: string, nonce: string, expiresAt: number): void;
  consumeAuthNonce(address: string, nonce: string): boolean;
  createAuthSession(token: string, playerId: string, expiresAt: number): void;
  getAuthSessionPlayerId(token: string): string | null;
  revokeAuthSession(token: string): void;
}

// ── SQLite implementation ──────────────────────────────────────────────────

class SQLiteDatabase implements DBBackend {
  db: any; // better-sqlite3 Database — exposed for the market module's raw queries

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        credits INTEGER DEFAULT 50,
        reputation INTEGER DEFAULT 0,
        x REAL DEFAULT 0,
        y REAL DEFAULT 0,
        z REAL DEFAULT -80,
        last_login TEXT,
        tutorial_done INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS parcels (
        id INTEGER PRIMARY KEY,
        grid_x INTEGER NOT NULL,
        grid_y INTEGER NOT NULL,
        owner_id TEXT,
        business_name TEXT,
        business_type TEXT,
        color TEXT DEFAULT '#4a90d9',
        height REAL DEFAULT 4,
        claimed_at TEXT,
        FOREIGN KEY (owner_id) REFERENCES players(id)
      );
    `);

    // Safely add tutorial_done column for existing databases
    try {
      this.db.exec(`ALTER TABLE players ADD COLUMN tutorial_done INTEGER DEFAULT 0`);
    } catch (_) {
      // Column already exists — ignore
    }
    // Appearance JSON (hat/shirt/pants/shoes/accessory + colors)
    try {
      this.db.exec(`ALTER TABLE players ADD COLUMN appearance TEXT`);
    } catch (_) { /* exists */ }

    // Resource columns
    for (const res of ['food', 'materials', 'energy', 'luxury']) {
      try {
        this.db.exec(`ALTER TABLE players ADD COLUMN ${res} REAL DEFAULT 0`);
      } catch (_) { /* exists */ }
    }

    // Phase 3 (2026-05-20): cumulative luxury burn drives the rank
    // system (Phase 4). NULL → not yet ranked; 0 → has clicked Burn but
    // chose 0 quantity (impossible today). Treat as 0 for all reads.
    try {
      this.db.exec(`ALTER TABLE players ADD COLUMN lifetime_luxury_burned INTEGER DEFAULT 0`);
    } catch (_) { /* exists */ }
    // Phase 4 (2026-05-20): current rank tier. NULL until first burn
    // promotes to Bronze. Stored as a string for human readability in
    // DB dumps; the enum is enforced application-side.
    try {
      this.db.exec(`ALTER TABLE players ADD COLUMN rank TEXT`);
    } catch (_) { /* exists */ }
    // Phase 6 (2026-05-20): offline accrual ledger. 0 means "never
    // settled" — first login treats this as no-missed-ticks. Otherwise
    // it's the world tick at the last settle. The accrual window caps
    // at MAX_OFFLINE_TICKS so sleep doesn't reward unbounded.
    try {
      this.db.exec(`ALTER TABLE players ADD COLUMN last_settled_tick INTEGER DEFAULT 0`);
    } catch (_) { /* exists */ }

    // UI Overhaul (2026-05-20): per-agent lifetime production stats —
    // surfaced on the 3D agent-click popup so owners can see what each
    // agent has contributed across its life. JSON blob keeps the schema
    // future-proof for new metric kinds without a migration.
    try {
      this.db.exec(`ALTER TABLE agents ADD COLUMN lifetime_wages_earned INTEGER DEFAULT 0`);
    } catch (_) { /* exists */ }
    try {
      this.db.exec(`ALTER TABLE agents ADD COLUMN lifetime_resources_produced TEXT`);
    } catch (_) { /* exists */ }
    try {
      this.db.exec(`ALTER TABLE agents ADD COLUMN lifetime_items_crafted TEXT`);
    } catch (_) { /* exists */ }

    // Building type on parcels (apartment, house, shop, farm, etc.)
    try {
      this.db.exec(`ALTER TABLE parcels ADD COLUMN building_type TEXT`);
    } catch (_) { /* exists */ }

    // Phase 3: named luxury items per wallet. One row per (player_id,
    // item_kind) pair; quantity rolls up. Items are produced by craft
    // agents, tradeable on the marketplace, and burnable for rank.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS luxury_items (
        player_id TEXT NOT NULL,
        item_kind TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (player_id, item_kind),
        FOREIGN KEY (player_id) REFERENCES players(id)
      );
      CREATE INDEX IF NOT EXISTS idx_luxury_items_player ON luxury_items(player_id);
    `);

    // Pre-launch one-shot: any player still parked at the legacy spawn
    // (400, 0, -200) gets teleported to the new rocket-facing spawn.
    // Players who have actually moved keep their position.
    this.db.exec(`UPDATE players SET x = 0, y = 0, z = -80 WHERE x = 400 AND y = 0 AND z = -200`);

    // Reserved-parcel cleanup: clear any owner/business on landmark plots
    // (e.g. the rocket cell at world origin). New claim attempts on these
    // are rejected by buyLand/claimAndBuild — this just unwinds historical
    // claims placed before the reservation was added.
    if (RESERVED_PARCEL_IDS.length > 0) {
      const placeholders = RESERVED_PARCEL_IDS.map(() => '?').join(', ');
      this.db.prepare(
        `UPDATE parcels SET owner_id = NULL, business_name = NULL, business_type = NULL, claimed_at = NULL WHERE id IN (${placeholders})`,
      ).run(...RESERVED_PARCEL_IDS);
    }

    // Events log
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        player_id TEXT,
        data TEXT,
        severity TEXT DEFAULT 'normal',
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    // Additive migration for existing DBs that pre-date the severity column.
    try {
      this.db.exec(`ALTER TABLE events ADD COLUMN severity TEXT DEFAULT 'normal'`);
    } catch (_) { /* exists */ }

    // Speed up the passive income tick which scans owner_id per income tick.
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_parcels_owner ON parcels(owner_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_severity ON events(severity, id DESC)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, id DESC)');

    // API agents (registered via REST)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        personality TEXT NOT NULL,
        strategy TEXT NOT NULL,
        api_key TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    // Phase B autopilot — when set, the server runs the agent's
    // personality routine each income tick.
    try { this.db.exec(`ALTER TABLE agents ADD COLUMN autopilot_enabled INTEGER DEFAULT 1`); } catch (_) { /* exists */ }
    try { this.db.exec(`ALTER TABLE agents ADD COLUMN last_autopilot_tick INTEGER DEFAULT 0`); } catch (_) { /* exists */ }
    // Identity unification (2026-05-16): every agent is owned by a wallet.
    // owner_wallet is the lowercased wallet address. Pre-existing agents
    // registered before this column existed will be NULL until their owner
    // claims them via /admin or the migration below.
    try { this.db.exec(`ALTER TABLE agents ADD COLUMN owner_wallet TEXT`); } catch (_) { /* exists */ }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_wallet)`);

    // Jobs (2026-05-16): each agent has a player-facing job id, an optional
    // workplace parcel (can belong to anyone), and a cloned appearance with
    // a job-specific hat. Legacy agents have NULL job — see
    // inferJobFromPersonality in shared/.
    try { this.db.exec(`ALTER TABLE agents ADD COLUMN job TEXT`); } catch (_) { /* exists */ }
    try { this.db.exec(`ALTER TABLE agents ADD COLUMN workplace_parcel_id INTEGER`); } catch (_) { /* exists */ }
    try { this.db.exec(`ALTER TABLE agents ADD COLUMN appearance TEXT`); } catch (_) { /* exists */ }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_workplace ON agents(workplace_parcel_id)`);

    // Phase 0 (2026-05-20): role enum replaces personality/strategy.
    // role ∈ {'work', 'produce', 'craft'}. is_external splits in-game
    // agents from external API-driven ones. dormant_at_tick + starvation
    // are populated in Phase 2 (starvation state machine).
    try { this.db.exec(`ALTER TABLE agents ADD COLUMN role TEXT DEFAULT 'work'`); } catch (_) { /* exists */ }
    try { this.db.exec(`ALTER TABLE agents ADD COLUMN is_external INTEGER DEFAULT 0`); } catch (_) { /* exists */ }
    try { this.db.exec(`ALTER TABLE agents ADD COLUMN dormant_at_tick INTEGER`); } catch (_) { /* exists */ }
    try { this.db.exec(`ALTER TABLE agents ADD COLUMN starvation_ticks INTEGER DEFAULT 0`); } catch (_) { /* exists */ }
    try { this.db.exec(`ALTER TABLE agents ADD COLUMN trading_budget_ameta INTEGER`); } catch (_) { /* exists */ }
    // Backfill role for legacy rows (NULL role): infer from personality.
    // Mapping: builder/ambitious → produce; all others → work. Trader will
    // be migrated to is_external=1 in Phase 5 with a separate sweep.
    try {
      this.db.exec(`
        UPDATE agents SET role = 'produce'
        WHERE role IS NULL AND personality IN ('builder', 'ambitious');
      `);
      this.db.exec(`
        UPDATE agents SET role = 'work'
        WHERE role IS NULL;
      `);
    } catch (e) {
      console.warn('[migration] role backfill failed:', (e as Error).message);
    }

    // Phase C: properties table = sub-units of multi-floor buildings
    // (apartment studios, office spaces). The legacy columns
    // (building_name/district/price/revenue_rate) were never wired up;
    // detect that legacy shape and drop it so the new schema can be
    // created cleanly.
    try {
      const cols = this.db.prepare(`PRAGMA table_info(properties)`).all() as Array<{ name: string }>;
      const hasLegacy = cols.some((c) => c.name === 'district') || !cols.some((c) => c.name === 'parcel_id');
      if (cols.length > 0 && hasLegacy) {
        this.db.exec(`DROP TABLE properties`);
      }
    } catch (_) { /* table doesn't exist yet */ }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS properties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parcel_id INTEGER NOT NULL,
        unit_type TEXT NOT NULL,           -- 'studio' | 'office' | 'penthouse'
        floor INTEGER NOT NULL,
        unit_index INTEGER NOT NULL,
        owner_id TEXT,
        list_price INTEGER,                -- NULL = not for sale
        income_per_tick INTEGER NOT NULL,
        FOREIGN KEY (parcel_id) REFERENCES parcels(id),
        FOREIGN KEY (owner_id) REFERENCES players(id)
      );
      CREATE INDEX IF NOT EXISTS idx_properties_parcel ON properties(parcel_id);
      CREATE INDEX IF NOT EXISTS idx_properties_owner ON properties(owner_id);
      CREATE INDEX IF NOT EXISTS idx_properties_listed ON properties(list_price) WHERE list_price IS NOT NULL;
    `);

    // Wallet auth — short-lived nonces (one per challenge) + long-lived
    // session tokens. Address is always stored lowercased.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_nonces (
        address TEXT NOT NULL,
        nonce TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (address, nonce)
      );
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token TEXT PRIMARY KEY,
        player_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_player ON auth_sessions(player_id);
    `);

    // Market order book + trade history. Resource is one of
    // food/materials/energy/luxury; side is buy|sell; status is
    // open|filled|cancelled. `filled` tracks partial fills.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS market_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        resource TEXT NOT NULL,
        side TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        price INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        filled INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (owner_id) REFERENCES players(id)
      );
      CREATE INDEX IF NOT EXISTS idx_orders_book ON market_orders(resource, side, status, price);
      CREATE INDEX IF NOT EXISTS idx_orders_owner ON market_orders(owner_id, status);

      CREATE TABLE IF NOT EXISTS market_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        resource TEXT NOT NULL,
        buyer_id TEXT NOT NULL,
        seller_id TEXT NOT NULL,
        price INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        fee INTEGER NOT NULL,
        executed_at INTEGER NOT NULL,
        FOREIGN KEY (buyer_id) REFERENCES players(id),
        FOREIGN KEY (seller_id) REFERENCES players(id)
      );
      CREATE INDEX IF NOT EXISTS idx_trades_resource ON market_trades(resource, executed_at DESC);
    `);

    // Phase E.3 — governance / decree system
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS decrees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proposer_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        action_type TEXT NOT NULL,
        action_params TEXT NOT NULL,           -- JSON
        proposed_at_tick INTEGER NOT NULL,
        vote_window_ticks INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active', -- active|passed|rejected|executed
        resolved_at_tick INTEGER,
        FOREIGN KEY (proposer_id) REFERENCES players(id)
      );
      CREATE INDEX IF NOT EXISTS idx_decrees_status ON decrees(status, id DESC);

      CREATE TABLE IF NOT EXISTS decree_votes (
        decree_id INTEGER NOT NULL,
        voter_id TEXT NOT NULL,
        weight INTEGER NOT NULL,
        choice INTEGER NOT NULL,                -- 0 = no, 1 = yes
        PRIMARY KEY (decree_id, voter_id),
        FOREIGN KEY (decree_id) REFERENCES decrees(id),
        FOREIGN KEY (voter_id) REFERENCES players(id)
      );
    `);

    // Phase E.2 — X (Twitter) verification scaffolding on agents.
    try { this.db.exec(`ALTER TABLE agents ADD COLUMN x_verified INTEGER DEFAULT 0`); } catch (_) { /* exists */ }
    try { this.db.exec(`ALTER TABLE agents ADD COLUMN x_handle TEXT`); } catch (_) { /* exists */ }

    // One-shot migration (2026-05-16): legacy `wallet_bots` table is being
    // collapsed into `agents`. Each row becomes an agent with default
    // personality/strategy and an auto-minted API key. The bot's existing
    // player record (balance, parcels, etc.) is preserved. After migration
    // the wallet_bots table is dropped.
    try {
      const hasTable = (this.db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='wallet_bots'`,
      ).get() as { name: string } | undefined);
      if (hasTable) {
        const rows = this.db.prepare(
          `SELECT wallet_address, bot_id, name FROM wallet_bots`,
        ).all() as Array<{ wallet_address: string; bot_id: string; name: string }>;
        const insert = this.db.prepare(
          `INSERT OR IGNORE INTO agents
             (id, name, personality, strategy, api_key, owner_wallet, autopilot_enabled)
           VALUES (?, ?, 'balanced', 'balanced', ?, ?, 0)`,
        );
        const namesInUse = new Set(
          (this.db.prepare(`SELECT name FROM agents`).all() as Array<{ name: string }>).map((r) => r.name),
        );
        for (const r of rows) {
          // Avoid the UNIQUE collision on `name` — append the wallet's last
          // 4 chars if the bot's name is already used by another agent.
          let name = r.name;
          if (namesInUse.has(name)) {
            const suffix = r.wallet_address.slice(-4);
            name = `${r.name}-${suffix}`;
            // Worst case keep stepping. Very unlikely to need more than once.
            let n = 2;
            while (namesInUse.has(name)) { name = `${r.name}-${suffix}-${n}`; n += 1; }
          }
          namesInUse.add(name);
          const rb = this.db.prepare(`SELECT lower(hex(randomblob(24))) AS h`).get() as { h: string };
          const apiKey = `tl_sk_${rb.h}`;
          insert.run(r.bot_id, name, apiKey, r.wallet_address.toLowerCase());
        }
        this.db.exec(`DROP TABLE wallet_bots`);
        if (rows.length > 0) {
          console.log(`[db] migrated ${rows.length} wallet_bots row(s) into agents`);
        }
      }
    } catch (e) {
      console.warn('[db] wallet_bots migration failed:', (e as Error).message);
    }
  }

  private get stmtGetPlayer() { return this.db.prepare('SELECT * FROM players WHERE id = ?'); }
  // Explicit position on insert: SQLite's CREATE TABLE … DEFAULT runs once
  // at table-creation time. The live DB was created with the old defaults
  // (400, 0, -200). Updating the CREATE TABLE clause has no effect on an
  // existing table, so we set position columns explicitly here to guarantee
  // new players spawn at the rocket-facing position regardless of when the
  // schema was first laid down.
  private get stmtInsertPlayer() {
    return this.db.prepare(
      `INSERT INTO players (id, name, x, y, z, last_login) VALUES (?, ?, 0, 0, -80, datetime('now'))`,
    );
  }
  private get stmtUpdateLogin() { return this.db.prepare(`UPDATE players SET last_login = datetime('now') WHERE id = ?`); }
  private get stmtSavePosition() { return this.db.prepare('UPDATE players SET x = ?, y = ?, z = ? WHERE id = ?'); }
  private get stmtUpdateCredits() { return this.db.prepare('UPDATE players SET credits = ? WHERE id = ?'); }
  private get stmtGetCredits() { return this.db.prepare('SELECT credits FROM players WHERE id = ?'); }
  private get stmtIsTutorialDone() { return this.db.prepare('SELECT tutorial_done FROM players WHERE id = ?'); }
  private get stmtMarkTutorialDone() { return this.db.prepare('UPDATE players SET tutorial_done = 1 WHERE id = ?'); }
  private get stmtCountParcels() { return this.db.prepare('SELECT COUNT(*) AS cnt FROM parcels'); }
  private get stmtInsertParcel() { return this.db.prepare('INSERT OR IGNORE INTO parcels (id, grid_x, grid_y) VALUES (?, ?, ?)'); }
  private get stmtGetParcel() { return this.db.prepare('SELECT * FROM parcels WHERE id = ?'); }
  private get stmtClaimParcel() { return this.db.prepare('UPDATE parcels SET owner_id = ?, claimed_at = datetime(\'now\') WHERE id = ? AND owner_id IS NULL'); }
  private get stmtUpdateBusiness() { return this.db.prepare('UPDATE parcels SET business_name = ?, business_type = ?, color = ?, height = ? WHERE id = ? AND owner_id = ?'); }

  getOrCreatePlayer(id: string, name: string): PlayerRow {
    let row = this.stmtGetPlayer.get(id) as PlayerRow | undefined;
    if (row) {
      this.stmtUpdateLogin.run(id);
      row.last_login = new Date().toISOString();
      // TEST_BALANCE: override credits on every login for testing
      const testBal = process.env.TEST_BALANCE;
      if (testBal) {
        const bal = parseInt(testBal, 10);
        if (!isNaN(bal)) {
          this.stmtUpdateCredits.run(bal, id);
          row.credits = bal;
        }
      }
      return row;
    }
    this.stmtInsertPlayer.run(id, name);
    row = this.stmtGetPlayer.get(id) as PlayerRow;
    // Apply TEST_BALANCE to new players too
    const testBal = process.env.TEST_BALANCE;
    if (testBal) {
      const bal = parseInt(testBal, 10);
      if (!isNaN(bal) && row) {
        this.stmtUpdateCredits.run(bal, id);
        row.credits = bal;
      }
    }
    return row;
  }

  savePlayerPosition(id: string, x: number, y: number, z: number): void {
    this.stmtSavePosition.run(x, y, z, id);
  }

  updatePlayerCredits(id: string, credits: number): void {
    this.stmtUpdateCredits.run(credits, id);
  }

  getPlayerCredits(id: string): number {
    const row = this.stmtGetCredits.get(id) as { credits: number } | undefined;
    return row?.credits ?? 0;
  }

  isTutorialDone(playerId: string): boolean {
    const row = this.stmtIsTutorialDone.get(playerId) as { tutorial_done: number } | undefined;
    return (row?.tutorial_done ?? 0) === 1;
  }

  markTutorialDone(playerId: string): void {
    this.stmtMarkTutorialDone.run(playerId);
  }

  seedParcels(): void {
    // Parcel id is computed `gx * GRID_COLS + gy`. If GRID_COLS ever
    // changes, every previously-seeded row now has the wrong id for its
    // (grid_x, grid_y) and INSERT OR IGNORE would silently duplicate rows.
    // Drop any stale-id rows before reseeding.
    this.db.prepare(
      'DELETE FROM parcels WHERE grid_x >= ? OR grid_y >= ? OR id != grid_x * ? + grid_y',
    ).run(GRID_COLS, GRID_ROWS, GRID_COLS);
    const insertMany = this.db.transaction(() => {
      for (let gx = 0; gx < GRID_COLS; gx++) {
        for (let gy = 0; gy < GRID_ROWS; gy++) {
          this.stmtInsertParcel.run(gx * GRID_COLS + gy, gx, gy);
        }
      }
    });
    insertMany();
  }

  claimParcel(parcelId: number, playerId: string): boolean {
    const txn = this.db.transaction(() => {
      const parcel = this.stmtGetParcel.get(parcelId) as ParcelRow | undefined;
      if (!parcel || parcel.owner_id !== null) return false;
      const credits = this.getPlayerCredits(playerId);
      if (credits < LAND_COST) return false;
      this.stmtUpdateCredits.run(credits - LAND_COST, playerId);
      const result = this.stmtClaimParcel.run(playerId, parcelId);
      return result.changes > 0;
    });
    return txn();
  }

  playerExists(id: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM players WHERE id = ?').get(id) as { '1': number } | undefined;
    return !!row;
  }

  transferCredits(fromId: string, toId: string, amount: number): { ok: boolean; reason?: string } {
    const txn = this.db.transaction(() => {
      if (amount <= 0 || !Number.isFinite(amount)) return { ok: false, reason: 'invalid_amount' };
      if (fromId === toId) return { ok: false, reason: 'self_transfer' };
      if (!this.playerExists(toId)) return { ok: false, reason: 'target_not_found' };
      const fromCredits = this.getPlayerCredits(fromId);
      if (fromCredits < amount) return { ok: false, reason: 'insufficient_balance' };
      const toCredits = this.getPlayerCredits(toId);
      this.stmtUpdateCredits.run(fromCredits - amount, fromId);
      this.stmtUpdateCredits.run(toCredits + amount, toId);
      return { ok: true };
    });
    return txn();
  }

  workProduce(
    id: string,
    creditsEarned: number,
    newResources: { food: number; materials: number; energy: number; luxury: number },
  ): { credits: number } {
    const txn = this.db.transaction(() => {
      const creditsBefore = this.getPlayerCredits(id);
      const creditsAfter = creditsBefore + creditsEarned;
      if (creditsEarned !== 0) this.stmtUpdateCredits.run(creditsAfter, id);
      this.updatePlayerResources(id, newResources);
      return { credits: creditsAfter };
    });
    return txn();
  }

  buyLand(id: string, parcelId: number): { ok: boolean; reason?: string; credits?: number } {
    if (RESERVED_SET.has(parcelId)) return { ok: false, reason: 'reserved_landmark' };
    const txn = this.db.transaction(() => {
      const parcel = this.stmtGetParcel.get(parcelId) as ParcelRow | undefined;
      if (!parcel) return { ok: false, reason: 'parcel_not_found' };
      if (parcel.owner_id !== null) return { ok: false, reason: 'already_claimed' };
      const fee = propertyFee(LAND_COST);
      const total = LAND_COST + fee;
      const credits = this.getPlayerCredits(id);
      if (credits < total) return { ok: false, reason: 'insufficient_balance' };
      this.stmtUpdateCredits.run(credits - total, id);
      this.creditTreasurySync(fee);
      const result = this.stmtClaimParcel.run(id, parcelId);
      if (result.changes === 0) return { ok: false, reason: 'claim_race' };
      return { ok: true, credits: credits - total };
    });
    return txn();
  }

  claimAndBuild(
    id: string,
    parcelId: number,
    buildingType: string,
    buildingCost: number,
    buildingLabel: string,
    materialCost = 0,
  ): { ok: boolean; reason?: string; credits?: number } {
    if (RESERVED_SET.has(parcelId)) return { ok: false, reason: 'reserved_landmark' };
    const txn = this.db.transaction(() => {
      const parcel = this.stmtGetParcel.get(parcelId) as ParcelRow | undefined;
      if (!parcel) return { ok: false, reason: 'parcel_not_found' };
      if (parcel.owner_id !== null) return { ok: false, reason: 'already_claimed' };
      // Phase 4 (2026-05-20): 1% property fee on top of gross. Goes
      // straight to the treasury (one wallet for property + agent fees
      // per owner spec).
      const gross = LAND_COST + buildingCost;
      const fee = propertyFee(gross);
      const total = gross + fee;
      const credits = this.getPlayerCredits(id);
      if (credits < total) return { ok: false, reason: 'insufficient_balance' };
      // Phase 1 (2026-05-20): materials required for construction. Spec
      // §9 sets per-tier costs; legacy (tier 0) buildings have 0 materials.
      if (materialCost > 0) {
        const resources = this.getPlayerResources(id);
        if (resources.materials < materialCost) {
          return { ok: false, reason: 'insufficient_materials' };
        }
        resources.materials -= materialCost;
        this.updatePlayerResources(id, resources);
      }
      this.stmtUpdateCredits.run(credits - total, id);
      // Treasury credit (synchronous inside the transaction — same DB,
      // upsert the row if it doesn't exist yet).
      this.creditTreasurySync(fee);
      const claim = this.stmtClaimParcel.run(id, parcelId);
      if (claim.changes === 0) return { ok: false, reason: 'claim_race' };
      this.db.prepare('UPDATE parcels SET building_type = ? WHERE id = ?').run(buildingType, parcelId);
      this.stmtUpdateBusiness.run(buildingLabel, buildingType, parcel.color, parcel.height, parcelId, id);
      return { ok: true, credits: credits - total };
    });
    return txn();
  }

  /** Synchronous treasury credit + lazy upsert. Used inside DB
   *  transactions where we can't await economy().credit. */
  private creditTreasurySync(amount: number): void {
    if (amount <= 0) return;
    // Ensure the treasury player row exists; safe to call repeatedly.
    this.db.prepare(
      `INSERT INTO players (id, name, credits) VALUES (?, ?, 0)
       ON CONFLICT(id) DO NOTHING`,
    ).run(WORLD_TREASURY_ID, 'World Treasury');
    this.db.prepare(
      `UPDATE players SET credits = credits + ? WHERE id = ?`,
    ).run(amount, WORLD_TREASURY_ID);
  }

  getOwnedBuiltParcels(): Array<{ id: number; owner_id: string; building_type: string }> {
    return this.db
      .prepare(`SELECT id, owner_id, building_type FROM parcels
                WHERE owner_id IS NOT NULL AND building_type IS NOT NULL`)
      .all() as Array<{ id: number; owner_id: string; building_type: string }>;
  }

  updateBusiness(parcelId: number, playerId: string, data: BusinessUpdate): boolean {
    const parcel = this.stmtGetParcel.get(parcelId) as ParcelRow | undefined;
    if (!parcel || parcel.owner_id !== playerId) return false;
    const name = data.name ?? parcel.business_name ?? '';
    const type = data.type ?? parcel.business_type ?? '';
    const color = data.color ?? parcel.color;
    const height = data.height ?? parcel.height;
    const result = this.stmtUpdateBusiness.run(name, type, color, height, parcelId, playerId);
    return result.changes > 0;
  }

  getAllParcels(): ParcelRow[] {
    return this.db.prepare('SELECT * FROM parcels').all() as ParcelRow[];
  }

  getParcelOwner(parcelId: number): string | null {
    const row = this.db.prepare('SELECT owner_id FROM parcels WHERE id = ?').get(parcelId) as { owner_id: string | null } | undefined;
    return row?.owner_id ?? null;
  }

  wipeParcels(): void {
    this.db.prepare(`
      UPDATE parcels SET
        owner_id = NULL,
        business_name = NULL,
        business_type = NULL,
        color = '#4a90d9',
        height = 4,
        claimed_at = NULL
    `).run();
  }

  wipePlayerParcels(id: string): number {
    const result = this.db.prepare(`
      UPDATE parcels SET
        owner_id = NULL,
        business_name = NULL,
        business_type = NULL,
        building_type = NULL,
        color = '#4a90d9',
        height = 4,
        claimed_at = NULL
      WHERE owner_id = ?
    `).run(id);
    return result.changes as number;
  }

  getAllPlayers(): PlayerRow[] {
    return this.db.prepare('SELECT * FROM players').all() as PlayerRow[];
  }

  deletePlayer(id: string): boolean {
    this.db.prepare(`
      UPDATE parcels SET
        owner_id = NULL,
        business_name = NULL,
        business_type = NULL,
        claimed_at = NULL
      WHERE owner_id = ?
    `).run(id);
    const result = this.db.prepare('DELETE FROM players WHERE id = ?').run(id);
    return result.changes > 0;
  }

  savePlayerAppearance(id: string, appearanceJson: string): void {
    this.db.prepare('UPDATE players SET appearance = ? WHERE id = ?').run(appearanceJson, id);
  }

  getPlayerResources(id: string): { food: number; materials: number; energy: number; luxury: number } {
    const row = this.db.prepare('SELECT food, materials, energy, luxury FROM players WHERE id = ?').get(id) as
      { food: number; materials: number; energy: number; luxury: number } | undefined;
    return row ?? { food: 0, materials: 0, energy: 0, luxury: 0 };
  }

  updatePlayerResources(id: string, r: { food: number; materials: number; energy: number; luxury: number }): void {
    this.db.prepare('UPDATE players SET food = ?, materials = ?, energy = ?, luxury = ? WHERE id = ?')
      .run(r.food, r.materials, r.energy, r.luxury, id);
  }

  setBuildingType(parcelId: number, buildingType: string): void {
    this.db.prepare('UPDATE parcels SET building_type = ? WHERE id = ?').run(buildingType, parcelId);
  }

  getPlayerParcels(playerId: string): ParcelRow[] {
    return this.db.prepare('SELECT * FROM parcels WHERE owner_id = ?').all(playerId) as ParcelRow[];
  }

  addEvent(type: string, playerId: string | null, data: Record<string, unknown>, severity: string = 'normal'): void {
    this.db.prepare('INSERT INTO events (type, player_id, data, severity) VALUES (?, ?, ?, ?)').run(type, playerId, JSON.stringify(data), severity);
  }

  getEvents(limit: number = 50, opts?: { severity?: string; type?: string; playerId?: string }): Array<{ id: number; type: string; player_id: string | null; data: string; severity: string; created_at: string }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts?.severity) { where.push('severity = ?'); params.push(opts.severity); }
    if (opts?.type)     { where.push('type = ?');     params.push(opts.type); }
    if (opts?.playerId) { where.push('player_id = ?'); params.push(opts.playerId); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return this.db.prepare(`SELECT * FROM events ${whereSql} ORDER BY id DESC LIMIT ?`).all(...params, limit) as any[];
  }

  registerAgent(
    id: string, name: string, personality: string, strategy: string,
    apiKey: string, ownerWallet: string | null,
    job: string | null, workplaceParcelId: number | null, appearanceJson: string | null,
  ): void {
    this.db.prepare(
      `INSERT INTO agents (id, name, personality, strategy, api_key, owner_wallet, job, workplace_parcel_id, appearance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, name, personality, strategy, apiKey,
      ownerWallet ? ownerWallet.toLowerCase() : null,
      job, workplaceParcelId, appearanceJson,
    );
    // Also create a player record so the agent can interact with the game.
    // New agents start at 0 — owners fund them via economy().allocate.
    this.db.prepare(`INSERT OR IGNORE INTO players (id, name, credits) VALUES (?, ?, 0)`).run(id, name);
    // Mirror the agent's appearance into the player record so the render
    // path picks it up via the same field humans use.
    if (appearanceJson) {
      this.db.prepare(`UPDATE players SET appearance = ? WHERE id = ?`).run(appearanceJson, id);
    }
  }

  getAgentByApiKey(apiKey: string): { id: string; name: string } | null {
    const row = this.db.prepare('SELECT id, name FROM agents WHERE api_key = ?').get(apiKey) as { id: string; name: string } | undefined;
    return row ?? null;
  }

  getAllAgents(): AgentRow[] {
    return this.db.prepare(
      `SELECT id, name, personality, strategy, role, is_external, dormant_at_tick,
              starvation_ticks, trading_budget_ameta,
              autopilot_enabled, last_autopilot_tick, created_at,
              owner_wallet, job, workplace_parcel_id, appearance
         FROM agents`,
    ).all() as AgentRow[];
  }

  getAgentsByWallet(walletAddress: string): AgentRow[] {
    return this.db.prepare(
      `SELECT id, name, personality, strategy, role, is_external, dormant_at_tick,
              starvation_ticks, trading_budget_ameta,
              autopilot_enabled, last_autopilot_tick, created_at,
              owner_wallet, job, workplace_parcel_id, appearance
         FROM agents WHERE owner_wallet = ? ORDER BY created_at ASC`,
    ).all(walletAddress.toLowerCase()) as AgentRow[];
  }

  getAgentById(agentId: string): AgentRow | null {
    return this.db.prepare(
      `SELECT id, name, personality, strategy, role, is_external, dormant_at_tick,
              starvation_ticks, trading_budget_ameta,
              autopilot_enabled, last_autopilot_tick, created_at,
              owner_wallet, job, workplace_parcel_id, appearance
         FROM agents WHERE id = ?`,
    ).get(agentId) as AgentRow | undefined ?? null;
  }

  countAgentsByWallet(walletAddress: string): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS n FROM agents WHERE owner_wallet = ?`,
    ).get(walletAddress.toLowerCase()) as { n: number };
    return row.n;
  }

  countAgentsByWalletAndKind(walletAddress: string, isExternal: 0 | 1): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS n FROM agents WHERE owner_wallet = ? AND is_external = ?`,
    ).get(walletAddress.toLowerCase(), isExternal) as { n: number };
    return row.n;
  }

  setAgentStarvation(agentId: string, starvationTicks: number, dormantAtTick: number | null): void {
    this.db.prepare(
      `UPDATE agents SET starvation_ticks = ?, dormant_at_tick = ? WHERE id = ?`,
    ).run(starvationTicks, dormantAtTick, agentId);
  }

  setAgentRole(agentId: string, role: string): void {
    this.db.prepare(`UPDATE agents SET role = ? WHERE id = ?`).run(role, agentId);
  }

  getPlayerItems(playerId: string): Record<string, number> {
    const rows = this.db.prepare(
      `SELECT item_kind, quantity FROM luxury_items WHERE player_id = ?`,
    ).all(playerId) as Array<{ item_kind: string; quantity: number }>;
    const out: Record<string, number> = {};
    for (const r of rows) out[r.item_kind] = r.quantity;
    return out;
  }

  addPlayerItems(playerId: string, itemKind: string, delta: number): number {
    if (delta === 0) {
      const row = this.db.prepare(
        `SELECT quantity FROM luxury_items WHERE player_id = ? AND item_kind = ?`,
      ).get(playerId, itemKind) as { quantity: number } | undefined;
      return row?.quantity ?? 0;
    }
    // Upsert with bounded-by-0 guard.
    const txn = this.db.transaction(() => {
      const existing = this.db.prepare(
        `SELECT quantity FROM luxury_items WHERE player_id = ? AND item_kind = ?`,
      ).get(playerId, itemKind) as { quantity: number } | undefined;
      const cur = existing?.quantity ?? 0;
      const next = Math.max(0, cur + delta);
      if (existing) {
        this.db.prepare(
          `UPDATE luxury_items SET quantity = ? WHERE player_id = ? AND item_kind = ?`,
        ).run(next, playerId, itemKind);
      } else if (next > 0) {
        this.db.prepare(
          `INSERT INTO luxury_items (player_id, item_kind, quantity) VALUES (?, ?, ?)`,
        ).run(playerId, itemKind, next);
      }
      return next;
    });
    return txn();
  }

  burnLuxuryItems(
    playerId: string, itemKind: string, quantity: number, burnValue: number,
  ): {
    ok: boolean; reason?: string;
    lifetime?: number; gained?: number;
    rankBefore?: string | null; rankAfter?: string | null;
  } {
    if (quantity <= 0) return { ok: false, reason: 'quantity_must_be_positive' };
    const txn = this.db.transaction(() => {
      const row = this.db.prepare(
        `SELECT quantity FROM luxury_items WHERE player_id = ? AND item_kind = ?`,
      ).get(playerId, itemKind) as { quantity: number } | undefined;
      const have = row?.quantity ?? 0;
      if (have < quantity) return { ok: false as const, reason: 'insufficient_items' };
      const remaining = have - quantity;
      this.db.prepare(
        `UPDATE luxury_items SET quantity = ? WHERE player_id = ? AND item_kind = ?`,
      ).run(remaining, playerId, itemKind);
      const gained = quantity * burnValue;
      // Snapshot pre-burn rank so the caller can detect promotion.
      const pre = this.db.prepare(
        `SELECT rank, lifetime_luxury_burned AS n FROM players WHERE id = ?`,
      ).get(playerId) as { rank: string | null; n: number | null } | undefined;
      const rankBefore = pre?.rank ?? null;
      const newLifetime = (pre?.n ?? 0) + gained;
      const rankAfter = rankFromLifetimeBurn(newLifetime);
      this.db.prepare(
        `UPDATE players SET lifetime_luxury_burned = ?, rank = ? WHERE id = ?`,
      ).run(newLifetime, rankAfter, playerId);
      return { ok: true as const, lifetime: newLifetime, gained, rankBefore, rankAfter };
    });
    return txn();
  }

  getLifetimeLuxuryBurned(playerId: string): number {
    const row = this.db.prepare(
      `SELECT lifetime_luxury_burned AS n FROM players WHERE id = ?`,
    ).get(playerId) as { n: number | null } | undefined;
    return row?.n ?? 0;
  }

  bumpLifetimeLuxury(
    playerId: string, amount: number,
  ): { lifetime: number; rankBefore: string | null; rankAfter: string | null } {
    if (!Number.isFinite(amount) || amount <= 0) {
      // No-op for zero/negative — preserve current lifetime + rank.
      const cur = this.db.prepare(
        `SELECT rank, lifetime_luxury_burned AS n FROM players WHERE id = ?`,
      ).get(playerId) as { rank: string | null; n: number | null } | undefined;
      return { lifetime: cur?.n ?? 0, rankBefore: cur?.rank ?? null, rankAfter: cur?.rank ?? null };
    }
    const txn = this.db.transaction(() => {
      const pre = this.db.prepare(
        `SELECT rank, lifetime_luxury_burned AS n FROM players WHERE id = ?`,
      ).get(playerId) as { rank: string | null; n: number | null } | undefined;
      const rankBefore = pre?.rank ?? null;
      const newLifetime = (pre?.n ?? 0) + amount;
      const rankAfter = rankFromLifetimeBurn(newLifetime);
      this.db.prepare(
        `UPDATE players SET lifetime_luxury_burned = ?, rank = ? WHERE id = ?`,
      ).run(newLifetime, rankAfter, playerId);
      return { lifetime: newLifetime, rankBefore, rankAfter };
    });
    return txn();
  }

  getPlayerRank(playerId: string): string | null {
    const row = this.db.prepare(
      `SELECT rank FROM players WHERE id = ?`,
    ).get(playerId) as { rank: string | null } | undefined;
    return row?.rank ?? null;
  }

  setPlayerRank(playerId: string, rank: string | null): void {
    this.db.prepare(`UPDATE players SET rank = ? WHERE id = ?`).run(rank, playerId);
  }

  getLastSettledTick(playerId: string): number {
    const row = this.db.prepare(
      `SELECT last_settled_tick AS n FROM players WHERE id = ?`,
    ).get(playerId) as { n: number | null } | undefined;
    return row?.n ?? 0;
  }

  setLastSettledTick(playerId: string, tick: number): void {
    this.db.prepare(`UPDATE players SET last_settled_tick = ? WHERE id = ?`).run(tick, playerId);
  }

  bumpAgentLifetimeStats(
    agentId: string,
    delta: { wages?: number; resources?: Record<string, number>; items?: Record<string, number> },
  ): void {
    const row = this.db.prepare(
      `SELECT lifetime_wages_earned AS w, lifetime_resources_produced AS r, lifetime_items_crafted AS i FROM agents WHERE id = ?`,
    ).get(agentId) as { w: number | null; r: string | null; i: string | null } | undefined;
    if (!row) return;
    const newWages = (row.w ?? 0) + (delta.wages ?? 0);
    const curRes = row.r ? safeJsonObj(row.r) : {};
    if (delta.resources) {
      for (const [k, v] of Object.entries(delta.resources)) curRes[k] = (curRes[k] ?? 0) + v;
    }
    const curItems = row.i ? safeJsonObj(row.i) : {};
    if (delta.items) {
      for (const [k, v] of Object.entries(delta.items)) curItems[k] = (curItems[k] ?? 0) + v;
    }
    this.db.prepare(
      `UPDATE agents SET lifetime_wages_earned = ?, lifetime_resources_produced = ?, lifetime_items_crafted = ? WHERE id = ?`,
    ).run(newWages, JSON.stringify(curRes), JSON.stringify(curItems), agentId);
  }

  getAgentLifetimeStats(agentId: string) {
    const row = this.db.prepare(
      `SELECT lifetime_wages_earned AS w, lifetime_resources_produced AS r, lifetime_items_crafted AS i FROM agents WHERE id = ?`,
    ).get(agentId) as { w: number | null; r: string | null; i: string | null } | undefined;
    return {
      wages: row?.w ?? 0,
      resources: row?.r ? safeJsonObj(row.r) : {},
      items: row?.i ? safeJsonObj(row.i) : {},
    };
  }

  setAgentWorkplace(agentId: string, parcelId: number | null): void {
    this.db.prepare('UPDATE agents SET workplace_parcel_id = ? WHERE id = ?').run(parcelId, agentId);
  }

  tickReputation(): Array<{ owner_id: string; consumed: number }> {
    // Aggregate shop count per owner, then deduct min(luxury, shopCount)
    // from each owner's luxury and add the same amount to reputation.
    const owners = this.db.prepare(`
      SELECT owner_id, COUNT(*) AS shop_count FROM parcels
      WHERE owner_id IS NOT NULL AND building_type = 'shop'
      GROUP BY owner_id
    `).all() as Array<{ owner_id: string; shop_count: number }>;
    if (owners.length === 0) return [];

    const summary: Array<{ owner_id: string; consumed: number }> = [];
    const tx = this.db.transaction((rows: typeof owners) => {
      for (const row of rows) {
        const player = this.db.prepare('SELECT luxury, reputation FROM players WHERE id = ?').get(row.owner_id) as { luxury: number; reputation: number } | undefined;
        if (!player) continue;
        const consumed = Math.min(Math.floor(player.luxury), row.shop_count);
        if (consumed <= 0) continue;
        this.db.prepare('UPDATE players SET luxury = luxury - ?, reputation = reputation + ? WHERE id = ?')
          .run(consumed, consumed, row.owner_id);
        summary.push({ owner_id: row.owner_id, consumed });
      }
    });
    tx(owners);
    return summary;
  }

  createAuthNonce(address: string, nonce: string, expiresAt: number): void {
    // Best-effort cleanup of expired nonces — keeps the table from growing
    // unboundedly under sustained challenge spam.
    this.db.prepare('DELETE FROM auth_nonces WHERE expires_at < ?').run(Date.now());
    this.db.prepare('INSERT OR REPLACE INTO auth_nonces (address, nonce, expires_at) VALUES (?, ?, ?)').run(address, nonce, expiresAt);
  }

  consumeAuthNonce(address: string, nonce: string): boolean {
    const row = this.db.prepare('SELECT expires_at FROM auth_nonces WHERE address = ? AND nonce = ?').get(address, nonce) as { expires_at: number } | undefined;
    if (!row) return false;
    this.db.prepare('DELETE FROM auth_nonces WHERE address = ? AND nonce = ?').run(address, nonce);
    return row.expires_at >= Date.now();
  }

  createAuthSession(token: string, playerId: string, expiresAt: number): void {
    this.db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(Date.now());
    this.db.prepare('INSERT INTO auth_sessions (token, player_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(token, playerId, expiresAt, Date.now());
  }

  getAuthSessionPlayerId(token: string): string | null {
    const row = this.db.prepare('SELECT player_id, expires_at FROM auth_sessions WHERE token = ?').get(token) as { player_id: string; expires_at: number } | undefined;
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      this.db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
      return null;
    }
    return row.player_id;
  }

  revokeAuthSession(token: string): void {
    this.db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
  }
}

// ── In-Memory Map-based fallback ───────────────────────────────────────────

class MemoryDB implements DBBackend {
  private players = new Map<string, PlayerRow>();
  private parcels = new Map<number, ParcelRow>();

  constructor() {
    console.log('[db] Using in-memory Map fallback (better-sqlite3 unavailable)');
  }

  getOrCreatePlayer(id: string, name: string): PlayerRow {
    let row = this.players.get(id);
    if (row) {
      row.last_login = new Date().toISOString();
      return row;
    }
    row = {
      id,
      name,
      credits: 500,
      reputation: 0,
      x: 0,
      y: 0,
      z: -80,
      last_login: new Date().toISOString(),
      tutorial_done: 0,
      appearance: null,
    };
    this.players.set(id, row);
    return row;
  }

  savePlayerPosition(id: string, x: number, y: number, z: number): void {
    const row = this.players.get(id);
    if (row) { row.x = x; row.y = y; row.z = z; }
  }

  updatePlayerCredits(id: string, credits: number): void {
    const row = this.players.get(id);
    if (row) row.credits = credits;
  }

  getPlayerCredits(id: string): number {
    return this.players.get(id)?.credits ?? 0;
  }

  isTutorialDone(playerId: string): boolean {
    return (this.players.get(playerId)?.tutorial_done ?? 0) === 1;
  }

  markTutorialDone(playerId: string): void {
    const row = this.players.get(playerId);
    if (row) row.tutorial_done = 1;
  }

  seedParcels(): void {
    // Remove out-of-bounds parcels (handles grid shrinks).
    for (const [id, p] of this.parcels) {
      if (p.grid_x >= GRID_COLS || p.grid_y >= GRID_ROWS) this.parcels.delete(id);
    }
    // Insert any missing parcels for the current grid bounds.
    for (let gx = 0; gx < GRID_COLS; gx++) {
      for (let gy = 0; gy < GRID_ROWS; gy++) {
        const id = gx * GRID_COLS + gy;
        if (!this.parcels.has(id)) {
          this.parcels.set(id, {
            id,
            grid_x: gx,
            grid_y: gy,
            owner_id: null,
            business_name: null,
            business_type: null,
            color: '#4a90d9',
            height: 4,
            claimed_at: null,
          });
        }
      }
    }
  }

  claimParcel(parcelId: number, playerId: string): boolean {
    const parcel = this.parcels.get(parcelId);
    if (!parcel || parcel.owner_id !== null) return false;
    const credits = this.getPlayerCredits(playerId);
    if (credits < LAND_COST) return false;
    this.updatePlayerCredits(playerId, credits - LAND_COST);
    parcel.owner_id = playerId;
    parcel.claimed_at = new Date().toISOString();
    return true;
  }

  playerExists(id: string): boolean {
    return this.players.has(id);
  }

  transferCredits(fromId: string, toId: string, amount: number): { ok: boolean; reason?: string } {
    if (amount <= 0 || !Number.isFinite(amount)) return { ok: false, reason: 'invalid_amount' };
    if (fromId === toId) return { ok: false, reason: 'self_transfer' };
    if (!this.playerExists(toId)) return { ok: false, reason: 'target_not_found' };
    const fromCredits = this.getPlayerCredits(fromId);
    if (fromCredits < amount) return { ok: false, reason: 'insufficient_balance' };
    this.updatePlayerCredits(fromId, fromCredits - amount);
    this.updatePlayerCredits(toId, this.getPlayerCredits(toId) + amount);
    return { ok: true };
  }

  workProduce(
    id: string,
    creditsEarned: number,
    newResources: { food: number; materials: number; energy: number; luxury: number },
  ): { credits: number } {
    const creditsAfter = this.getPlayerCredits(id) + creditsEarned;
    if (creditsEarned !== 0) this.updatePlayerCredits(id, creditsAfter);
    this.updatePlayerResources(id, newResources);
    return { credits: creditsAfter };
  }

  buyLand(id: string, parcelId: number): { ok: boolean; reason?: string; credits?: number } {
    const parcel = this.parcels.get(parcelId);
    if (!parcel) return { ok: false, reason: 'parcel_not_found' };
    if (parcel.owner_id !== null) return { ok: false, reason: 'already_claimed' };
    const fee = propertyFee(LAND_COST);
    const total = LAND_COST + fee;
    const credits = this.getPlayerCredits(id);
    if (credits < total) return { ok: false, reason: 'insufficient_balance' };
    this.updatePlayerCredits(id, credits - total);
    this.creditTreasurySync(fee);
    parcel.owner_id = id;
    parcel.claimed_at = new Date().toISOString();
    return { ok: true, credits: credits - total };
  }

  claimAndBuild(
    id: string,
    parcelId: number,
    buildingType: string,
    buildingCost: number,
    buildingLabel: string,
    materialCost = 0,
  ): { ok: boolean; reason?: string; credits?: number } {
    const parcel = this.parcels.get(parcelId);
    if (!parcel) return { ok: false, reason: 'parcel_not_found' };
    if (parcel.owner_id !== null) return { ok: false, reason: 'already_claimed' };
    const gross = LAND_COST + buildingCost;
    const fee = propertyFee(gross);
    const total = gross + fee;
    const credits = this.getPlayerCredits(id);
    if (credits < total) return { ok: false, reason: 'insufficient_balance' };
    if (materialCost > 0) {
      const r = this.getPlayerResources(id);
      if (r.materials < materialCost) return { ok: false, reason: 'insufficient_materials' };
      r.materials -= materialCost;
      this.updatePlayerResources(id, r);
    }
    this.updatePlayerCredits(id, credits - total);
    this.creditTreasurySync(fee);
    parcel.owner_id = id;
    parcel.claimed_at = new Date().toISOString();
    (parcel as any).building_type = buildingType;
    parcel.business_type = buildingType;
    parcel.business_name = buildingLabel;
    return { ok: true, credits: credits - total };
  }

  private creditTreasurySync(amount: number): void {
    if (amount <= 0) return;
    if (!this.players.has(WORLD_TREASURY_ID)) {
      this.players.set(WORLD_TREASURY_ID, {
        id: WORLD_TREASURY_ID, name: 'World Treasury', credits: 0,
        reputation: 0, x: 0, y: 0, z: 0,
        last_login: new Date().toISOString(), tutorial_done: 0,
        appearance: null,
      });
    }
    const p = this.players.get(WORLD_TREASURY_ID)!;
    p.credits += amount;
  }

  getOwnedBuiltParcels(): Array<{ id: number; owner_id: string; building_type: string }> {
    const out: Array<{ id: number; owner_id: string; building_type: string }> = [];
    for (const p of this.parcels.values()) {
      const bt = (p as any).building_type as string | null;
      if (p.owner_id && bt) out.push({ id: p.id, owner_id: p.owner_id, building_type: bt });
    }
    return out;
  }

  updateBusiness(parcelId: number, playerId: string, data: BusinessUpdate): boolean {
    const parcel = this.parcels.get(parcelId);
    if (!parcel || parcel.owner_id !== playerId) return false;
    if (data.name !== undefined) parcel.business_name = data.name;
    if (data.type !== undefined) parcel.business_type = data.type;
    if (data.color !== undefined) parcel.color = data.color;
    if (data.height !== undefined) parcel.height = data.height;
    return true;
  }

  getAllParcels(): ParcelRow[] {
    return Array.from(this.parcels.values());
  }

  getParcelOwner(parcelId: number): string | null {
    return this.parcels.get(parcelId)?.owner_id ?? null;
  }

  wipeParcels(): void {
    for (const p of this.parcels.values()) {
      p.owner_id = null;
      p.business_name = null;
      p.business_type = null;
      p.color = '#4a90d9';
      p.height = 4;
      p.claimed_at = null;
    }
  }

  wipePlayerParcels(id: string): number {
    let n = 0;
    for (const p of this.parcels.values()) {
      if (p.owner_id === id) {
        p.owner_id = null;
        p.business_name = null;
        p.business_type = null;
        (p as ParcelRow & { building_type?: string | null }).building_type = null;
        p.color = '#4a90d9';
        p.height = 4;
        p.claimed_at = null;
        n++;
      }
    }
    return n;
  }

  getAllPlayers(): PlayerRow[] {
    return Array.from(this.players.values());
  }

  deletePlayer(id: string): boolean {
    for (const p of this.parcels.values()) {
      if (p.owner_id === id) {
        p.owner_id = null;
        p.business_name = null;
        p.business_type = null;
        p.claimed_at = null;
      }
    }
    return this.players.delete(id);
  }

  savePlayerAppearance(id: string, appearanceJson: string): void {
    const p = this.players.get(id);
    if (p) p.appearance = appearanceJson;
  }

  getPlayerResources(id: string) {
    const p = this.players.get(id);
    return { food: (p as any)?.food ?? 0, materials: (p as any)?.materials ?? 0, energy: (p as any)?.energy ?? 0, luxury: (p as any)?.luxury ?? 0 };
  }

  updatePlayerResources(id: string, r: { food: number; materials: number; energy: number; luxury: number }): void {
    const p = this.players.get(id) as any;
    if (p) { p.food = r.food; p.materials = r.materials; p.energy = r.energy; p.luxury = r.luxury; }
  }

  setBuildingType(parcelId: number, buildingType: string): void {
    const p = this.parcels.get(parcelId);
    if (p) (p as any).building_type = buildingType;
  }

  getPlayerParcels(playerId: string): ParcelRow[] {
    return Array.from(this.parcels.values()).filter(p => p.owner_id === playerId);
  }

  private events: Array<{ id: number; type: string; player_id: string | null; data: string; severity: string; created_at: string }> = [];
  private eventId = 0;

  addEvent(type: string, playerId: string | null, data: Record<string, unknown>, severity: string = 'normal'): void {
    this.events.push({ id: ++this.eventId, type, player_id: playerId, data: JSON.stringify(data), severity, created_at: new Date().toISOString() });
    if (this.events.length > 500) this.events.shift();
  }

  getEvents(limit: number = 50, opts?: { severity?: string; type?: string; playerId?: string }) {
    let arr = this.events;
    if (opts?.severity) arr = arr.filter((e) => e.severity === opts.severity);
    if (opts?.type)     arr = arr.filter((e) => e.type === opts.type);
    if (opts?.playerId) arr = arr.filter((e) => e.player_id === opts.playerId);
    return arr.slice(-limit).reverse();
  }

  private agents = new Map<string, AgentRow & { apiKey: string }>();

  registerAgent(
    id: string, name: string, personality: string, strategy: string,
    apiKey: string, ownerWallet: string | null,
    job: string | null, workplaceParcelId: number | null, appearanceJson: string | null,
  ): void {
    this.agents.set(apiKey, {
      id, name, personality, strategy, apiKey,
      role: personality === 'builder' || personality === 'ambitious' ? 'produce' : 'work',
      is_external: 0,
      dormant_at_tick: null,
      starvation_ticks: 0,
      trading_budget_ameta: null,
      autopilot_enabled: 1, last_autopilot_tick: 0,
      created_at: new Date().toISOString(),
      owner_wallet: ownerWallet ? ownerWallet.toLowerCase() : null,
      job, workplace_parcel_id: workplaceParcelId, appearance: appearanceJson,
    });
    // New agents start at 0 — owners fund them via economy().allocate.
    this.players.set(id, {
      id, name, credits: 0, reputation: 0,
      x: 0, y: 0, z: -80,
      last_login: new Date().toISOString(), tutorial_done: 0,
      appearance: appearanceJson,
    });
  }

  getAgentByApiKey(apiKey: string): { id: string; name: string } | null {
    const a = this.agents.get(apiKey);
    return a ? { id: a.id, name: a.name } : null;
  }

  getAllAgents(): AgentRow[] {
    return Array.from(this.agents.values()).map(({ apiKey: _k, ...rest }) => rest);
  }

  getAgentsByWallet(walletAddress: string): AgentRow[] {
    const addr = walletAddress.toLowerCase();
    return Array.from(this.agents.values())
      .filter((a) => a.owner_wallet === addr)
      .map(({ apiKey: _k, ...rest }) => rest)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  getAgentById(agentId: string): AgentRow | null {
    for (const a of this.agents.values()) {
      if (a.id === agentId) {
        const { apiKey: _k, ...rest } = a;
        return rest;
      }
    }
    return null;
  }

  countAgentsByWallet(walletAddress: string): number {
    const addr = walletAddress.toLowerCase();
    let n = 0;
    for (const a of this.agents.values()) if (a.owner_wallet === addr) n += 1;
    return n;
  }

  countAgentsByWalletAndKind(walletAddress: string, isExternal: 0 | 1): number {
    const addr = walletAddress.toLowerCase();
    let n = 0;
    for (const a of this.agents.values()) {
      if (a.owner_wallet === addr && a.is_external === isExternal) n += 1;
    }
    return n;
  }

  setAgentStarvation(agentId: string, starvationTicks: number, dormantAtTick: number | null): void {
    for (const a of this.agents.values()) {
      if (a.id === agentId) {
        a.starvation_ticks = starvationTicks;
        a.dormant_at_tick = dormantAtTick;
        return;
      }
    }
  }

  setAgentRole(agentId: string, role: string): void {
    for (const a of this.agents.values()) {
      if (a.id === agentId) { a.role = role; return; }
    }
  }

  private items = new Map<string, Map<string, number>>(); // playerId → kind → qty
  private lifetimeBurn = new Map<string, number>();
  private rankByPlayer = new Map<string, string | null>();

  getPlayerItems(playerId: string): Record<string, number> {
    const m = this.items.get(playerId);
    if (!m) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of m) out[k] = v;
    return out;
  }

  addPlayerItems(playerId: string, itemKind: string, delta: number): number {
    let m = this.items.get(playerId);
    if (!m) { m = new Map(); this.items.set(playerId, m); }
    const next = Math.max(0, (m.get(itemKind) ?? 0) + delta);
    if (next === 0) m.delete(itemKind);
    else m.set(itemKind, next);
    return next;
  }

  burnLuxuryItems(
    playerId: string, itemKind: string, quantity: number, burnValue: number,
  ): {
    ok: boolean; reason?: string;
    lifetime?: number; gained?: number;
    rankBefore?: string | null; rankAfter?: string | null;
  } {
    if (quantity <= 0) return { ok: false, reason: 'quantity_must_be_positive' };
    const m = this.items.get(playerId);
    const have = m?.get(itemKind) ?? 0;
    if (have < quantity) return { ok: false, reason: 'insufficient_items' };
    if (m) {
      const remaining = have - quantity;
      if (remaining === 0) m.delete(itemKind);
      else m.set(itemKind, remaining);
    }
    const gained = quantity * burnValue;
    const lifetime = (this.lifetimeBurn.get(playerId) ?? 0) + gained;
    this.lifetimeBurn.set(playerId, lifetime);
    const rankBefore = this.rankByPlayer.get(playerId) ?? null;
    const rankAfter = rankFromLifetimeBurn(lifetime);
    this.rankByPlayer.set(playerId, rankAfter);
    return { ok: true, lifetime, gained, rankBefore, rankAfter };
  }

  getLifetimeLuxuryBurned(playerId: string): number {
    return this.lifetimeBurn.get(playerId) ?? 0;
  }

  bumpLifetimeLuxury(
    playerId: string, amount: number,
  ): { lifetime: number; rankBefore: string | null; rankAfter: string | null } {
    const rankBefore = this.rankByPlayer.get(playerId) ?? null;
    if (!Number.isFinite(amount) || amount <= 0) {
      return { lifetime: this.lifetimeBurn.get(playerId) ?? 0, rankBefore, rankAfter: rankBefore };
    }
    const lifetime = (this.lifetimeBurn.get(playerId) ?? 0) + amount;
    this.lifetimeBurn.set(playerId, lifetime);
    const rankAfter = rankFromLifetimeBurn(lifetime);
    this.rankByPlayer.set(playerId, rankAfter);
    return { lifetime, rankBefore, rankAfter };
  }

  getPlayerRank(playerId: string): string | null {
    return this.rankByPlayer.get(playerId) ?? null;
  }

  setPlayerRank(playerId: string, rank: string | null): void {
    this.rankByPlayer.set(playerId, rank);
  }

  private lastSettledByPlayer = new Map<string, number>();
  getLastSettledTick(playerId: string): number {
    return this.lastSettledByPlayer.get(playerId) ?? 0;
  }
  setLastSettledTick(playerId: string, tick: number): void {
    this.lastSettledByPlayer.set(playerId, tick);
  }

  private agentStats = new Map<string, { wages: number; resources: Record<string, number>; items: Record<string, number> }>();
  bumpAgentLifetimeStats(
    agentId: string,
    delta: { wages?: number; resources?: Record<string, number>; items?: Record<string, number> },
  ): void {
    const cur = this.agentStats.get(agentId) ?? { wages: 0, resources: {}, items: {} };
    cur.wages += delta.wages ?? 0;
    if (delta.resources) for (const [k, v] of Object.entries(delta.resources)) cur.resources[k] = (cur.resources[k] ?? 0) + v;
    if (delta.items)     for (const [k, v] of Object.entries(delta.items))     cur.items[k]     = (cur.items[k]     ?? 0) + v;
    this.agentStats.set(agentId, cur);
  }
  getAgentLifetimeStats(agentId: string) {
    return this.agentStats.get(agentId) ?? { wages: 0, resources: {}, items: {} };
  }

  setAgentWorkplace(agentId: string, parcelId: number | null): void {
    for (const a of this.agents.values()) {
      if (a.id === agentId) { a.workplace_parcel_id = parcelId; return; }
    }
  }

  tickReputation(): Array<{ owner_id: string; consumed: number }> {
    const shopCounts = new Map<string, number>();
    for (const p of this.parcels.values()) {
      if (!p.owner_id || (p as { building_type?: string }).building_type !== 'shop') continue;
      shopCounts.set(p.owner_id, (shopCounts.get(p.owner_id) ?? 0) + 1);
    }
    const summary: Array<{ owner_id: string; consumed: number }> = [];
    for (const [ownerId, shopCount] of shopCounts) {
      const player = this.players.get(ownerId) as (PlayerRow & { luxury?: number }) | undefined;
      if (!player) continue;
      const luxury = player.luxury ?? 0;
      const consumed = Math.min(Math.floor(luxury), shopCount);
      if (consumed <= 0) continue;
      player.luxury = luxury - consumed;
      player.reputation += consumed;
      summary.push({ owner_id: ownerId, consumed });
    }
    return summary;
  }

  // Wallet auth — kept in memory; loses state on restart, fine for fallback.
  private nonces = new Map<string, number>(); // `${address}:${nonce}` -> expiresAt
  private sessions = new Map<string, { playerId: string; expiresAt: number }>();

  createAuthNonce(address: string, nonce: string, expiresAt: number): void {
    this.nonces.set(`${address}:${nonce}`, expiresAt);
  }

  consumeAuthNonce(address: string, nonce: string): boolean {
    const key = `${address}:${nonce}`;
    const exp = this.nonces.get(key);
    if (!exp) return false;
    this.nonces.delete(key);
    return exp >= Date.now();
  }

  createAuthSession(token: string, playerId: string, expiresAt: number): void {
    this.sessions.set(token, { playerId, expiresAt });
  }

  getAuthSessionPlayerId(token: string): string | null {
    const s = this.sessions.get(token);
    if (!s) return null;
    if (s.expiresAt < Date.now()) { this.sessions.delete(token); return null; }
    return s.playerId;
  }

  revokeAuthSession(token: string): void { this.sessions.delete(token); }
}

// ── Database initialisation ────────────────────────────────────────────────

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.resolve(__dirname, '../../../../data/thirdlife.db');
const DATA_DIR = path.dirname(DB_PATH);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let backend: DBBackend;

try {
  backend = new SQLiteDatabase(DB_PATH);
  console.log('[db] Using SQLite backend');
} catch (err) {
  console.warn('[db] better-sqlite3 failed to load, falling back to in-memory Map:', (err as Error).message);
  backend = new MemoryDB();
}

// Reserved sink player for fees, taxes, treasury payouts. Created
// once per process with a zero starting balance (no STARTING_BALANCE
// gift). Duplicated from economy/IEconomy.ts to avoid an import cycle.
const WORLD_TREASURY_ID_BOOT = '__world_treasury__';
if (!backend.playerExists(WORLD_TREASURY_ID_BOOT)) {
  backend.getOrCreatePlayer(WORLD_TREASURY_ID_BOOT, 'World Treasury');
  backend.updatePlayerCredits(WORLD_TREASURY_ID_BOOT, 0);
}

// ── Public API ─────────────────────────────────────────────────────────────

export function getOrCreatePlayer(id: string, name: string): PlayerRow {
  return backend.getOrCreatePlayer(id, name);
}

export function savePlayerPosition(id: string, x: number, y: number, z: number): void {
  backend.savePlayerPosition(id, x, y, z);
}

export function updatePlayerCredits(id: string, credits: number): void {
  backend.updatePlayerCredits(id, credits);
}

export function getPlayerCredits(id: string): number {
  return backend.getPlayerCredits(id);
}

export function isTutorialDone(playerId: string): boolean {
  return backend.isTutorialDone(playerId);
}

export function markTutorialDone(playerId: string): void {
  backend.markTutorialDone(playerId);
}

export function seedParcels(): void {
  backend.seedParcels();
}

export function claimParcel(parcelId: number, playerId: string): boolean {
  return backend.claimParcel(parcelId, playerId);
}

export function updateBusiness(parcelId: number, playerId: string, data: BusinessUpdate): boolean {
  return backend.updateBusiness(parcelId, playerId, data);
}

export function getAllParcels(): ParcelRow[] {
  return backend.getAllParcels();
}

export function getParcelOwner(parcelId: number): string | null {
  return backend.getParcelOwner(parcelId);
}

export function wipeParcels(): void {
  backend.wipeParcels();
}

export function wipePlayerParcels(id: string): number {
  return backend.wipePlayerParcels(id);
}

export function getAllPlayers(): PlayerRow[] {
  return backend.getAllPlayers();
}

export function deletePlayer(id: string): boolean {
  return backend.deletePlayer(id);
}

export function savePlayerAppearance(id: string, appearanceJson: string): void {
  backend.savePlayerAppearance(id, appearanceJson);
}

export function getPlayerResources(id: string) { return backend.getPlayerResources(id); }
export function updatePlayerResources(id: string, r: { food: number; materials: number; energy: number; luxury: number }) { backend.updatePlayerResources(id, r); }
export function setBuildingType(parcelId: number, buildingType: string) { backend.setBuildingType(parcelId, buildingType); }
export function getPlayerParcels(playerId: string) { return backend.getPlayerParcels(playerId); }
export function addEvent(type: string, playerId: string | null, data: Record<string, unknown>, severity?: string) {
  backend.addEvent(type, playerId, data, severity);
}
export function getEvents(limit?: number, opts?: { severity?: string; type?: string; playerId?: string }) {
  return backend.getEvents(limit, opts);
}
export function registerAgent(
  id: string, name: string, personality: string, strategy: string,
  apiKey: string, ownerWallet: string | null,
  job: string | null = null, workplaceParcelId: number | null = null, appearanceJson: string | null = null,
) {
  backend.registerAgent(id, name, personality, strategy, apiKey, ownerWallet, job, workplaceParcelId, appearanceJson);
}
export function getAgentByApiKey(apiKey: string) { return backend.getAgentByApiKey(apiKey); }
export function getAllAgents() { return backend.getAllAgents(); }
export function getAgentsByWallet(walletAddress: string) { return backend.getAgentsByWallet(walletAddress); }
export function getAgentById(agentId: string) { return backend.getAgentById(agentId); }
export function countAgentsByWallet(walletAddress: string) { return backend.countAgentsByWallet(walletAddress); }
export function countAgentsByWalletAndKind(walletAddress: string, isExternal: 0 | 1) {
  return backend.countAgentsByWalletAndKind(walletAddress, isExternal);
}
export function setAgentStarvation(agentId: string, starvationTicks: number, dormantAtTick: number | null) {
  backend.setAgentStarvation(agentId, starvationTicks, dormantAtTick);
}
export function setAgentRole(agentId: string, role: string) {
  backend.setAgentRole(agentId, role);
}
export function getPlayerItems(playerId: string) { return backend.getPlayerItems(playerId); }
export function addPlayerItems(playerId: string, itemKind: string, delta: number) {
  return backend.addPlayerItems(playerId, itemKind, delta);
}
export function burnLuxuryItems(playerId: string, itemKind: string, quantity: number, burnValue: number) {
  return backend.burnLuxuryItems(playerId, itemKind, quantity, burnValue);
}
export function bumpLifetimeLuxury(playerId: string, amount: number) {
  return backend.bumpLifetimeLuxury(playerId, amount);
}
export function getLifetimeLuxuryBurned(playerId: string) {
  return backend.getLifetimeLuxuryBurned(playerId);
}
export function getPlayerRank(playerId: string) { return backend.getPlayerRank(playerId); }
export function setPlayerRank(playerId: string, rank: string | null) {
  backend.setPlayerRank(playerId, rank);
}
export function getLastSettledTick(playerId: string) { return backend.getLastSettledTick(playerId); }
export function setLastSettledTick(playerId: string, tick: number) {
  backend.setLastSettledTick(playerId, tick);
}
export function bumpAgentLifetimeStats(
  agentId: string,
  delta: { wages?: number; resources?: Record<string, number>; items?: Record<string, number> },
) { backend.bumpAgentLifetimeStats(agentId, delta); }
export function getAgentLifetimeStats(agentId: string) {
  return backend.getAgentLifetimeStats(agentId);
}
export function setAgentWorkplace(agentId: string, parcelId: number | null) { backend.setAgentWorkplace(agentId, parcelId); }
export function tickReputation() { return backend.tickReputation(); }
export function playerExists(id: string) { return backend.playerExists(id); }
export function transferCredits(fromId: string, toId: string, amount: number) { return backend.transferCredits(fromId, toId, amount); }
export function workProduce(
  id: string,
  creditsEarned: number,
  newResources: { food: number; materials: number; energy: number; luxury: number },
) { return backend.workProduce(id, creditsEarned, newResources); }
export function buyLand(id: string, parcelId: number) { return backend.buyLand(id, parcelId); }
export function claimAndBuild(
  id: string, parcelId: number, buildingType: string, buildingCost: number, buildingLabel: string,
  materialCost = 0,
) { return backend.claimAndBuild(id, parcelId, buildingType, buildingCost, buildingLabel, materialCost); }
export function getOwnedBuiltParcels() { return backend.getOwnedBuiltParcels(); }
export function createAuthNonce(address: string, nonce: string, expiresAt: number) {
  backend.createAuthNonce(address, nonce, expiresAt);
}
export function consumeAuthNonce(address: string, nonce: string) {
  return backend.consumeAuthNonce(address, nonce);
}
export function createAuthSession(token: string, playerId: string, expiresAt: number) {
  backend.createAuthSession(token, playerId, expiresAt);
}
export function getAuthSessionPlayerId(token: string) {
  return backend.getAuthSessionPlayerId(token);
}
export function revokeAuthSession(token: string) {
  backend.revokeAuthSession(token);
}

/**
 * Raw better-sqlite3 handle. Used only by the market module, which needs
 * direct prepare/transaction access for the FIFO match engine. Throws
 * when the in-memory fallback is active (better-sqlite3 not available) —
 * the market requires SQLite.
 */
export function getRawDb(): import('better-sqlite3').Database {
  const sqlite = backend as Partial<SQLiteDatabase>;
  if (!sqlite.db) {
    throw new Error('getRawDb() requires the SQLite backend; better-sqlite3 is not loaded.');
  }
  return sqlite.db;
}
