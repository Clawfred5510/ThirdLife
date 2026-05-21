import { Router, Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import {
  getAllParcels,
  getAllPlayers,
  getPlayerResources,
  updatePlayerResources,
  getPlayerCredits,
  updatePlayerCredits,
  getPlayerParcels,
  setBuildingType,
  updateBusiness,
  addEvent,
  getEvents,
  registerAgent,
  getAgentByApiKey,
  getAgentById,
  getAgentsByWallet,
  countAgentsByWallet,
  countAgentsByWalletAndKind,
  setAgentStarvation,
  setAgentRole,
  burnLuxuryItems,
  getPlayerItems,
  getLifetimeLuxuryBurned,
  getAgentLifetimeStats,
  getAuthSessionPlayerId,
  workProduce,
  buyLand,
} from '../db';
import { economy, WORLD_TREASURY_ID } from '../economy';
import { inGameAgentCapFor, externalAgentCapFor, rankFor } from '../ranks';
import { placeOrder, cancelOrder, getBook, getOwnerOrders } from '../market/orderBook';
import { notifyAgentChanged } from '../events/agentEvents';
import { getLeaderboard, getNetWorth, isValidSort } from '../leaderboard';
import { getWorldTick, getLastTickGdp, recordGdp } from '../world';
import { getAllAgents, getRawDb as _rawDb } from '../db';
import { computeLevel, computeJob } from '../agents-meta';
// Sub-unit properties module retired 2026-05-20. The file still exists
// in src/properties so historic data resolves, but no API path mounts it.
import {
  proposeDecree,
  castVote,
  getActiveDecrees,
  getRecentDecrees,
  getVotes,
  isValidActionType,
} from '../governance';
import {
  BUILDINGS,
  BuildingType,
  BASE_MARKET_PRICES,
  ResourceType,
  RESOURCE_TYPES,
  LAND_COST,
  STARTING_BALANCE,
  IN_GAME_AGENT_COST_AMETA,
  REVIVE_COST_FOOD,
  LUXURY_ITEMS,
  LuxuryItemKind,
  TIER_INDEX,
  PROPERTY_FEE_BPS,
  BPS_DENOMINATOR,
  AGENT_ROLES,
  AgentRole,
  isMarketKind,
  AGENT_PERSONALITIES,
  AGENT_STRATEGIES,
  AgentPersonality,
  AgentStrategy,
  CURRENCY_NAME,
  JOBS,
  JOB_IDS,
  JobId,
  applyJobLook,
  DEFAULT_APPEARANCE,
  Appearance,
  TIER_NAMES,
  type Tier,
  RANK_BURN_THRESHOLD,
  rankFromLifetimeBurn,
  IN_GAME_AGENT_CAP_BY_RANK,
  EXTERNAL_AGENT_CAP_BY_RANK,
  LAND_CAP_BY_RANK,
  MARKETPLACE_FEE_BPS_BY_RANK,
} from '@gamestu/shared';
import { setAgentWorkplace, savePlayerPosition } from '../db';

const router = Router();

function generateApiKey(): string {
  return 'tl_sk_' + crypto.randomBytes(24).toString('hex');
}

function generateId(): string {
  return crypto.randomUUID();
}

// ── Failed-auth logging + bruteforce observability ──────────────────────

function logAuthFailure(req: Request, reason: 'missing_header' | 'invalid_key', apiKeyHint: string | null): void {
  const ip = (req.ip || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
  const ua = (req.headers['user-agent'] ?? '').toString().slice(0, 120);
  const path = req.path;
  // eslint-disable-next-line no-console
  console.warn(`[auth-fail] ip=${ip} path=${path} reason=${reason} key_hint=${apiKeyHint ?? '-'} ua="${ua}"`);
  addEvent('auth_failure', null, { ip, path, reason, key_hint: apiKeyHint, ua }, 'minor');
}

// ── Rate limiter: token bucket keyed by API key (auth'd) or IP (anon) ───
// 60 req/min sustained with burst of 30. In-process, single-node only — if
// we ever horizontally scale, swap for Redis-backed bucket.
const RATE_CAPACITY = 30;
const RATE_REFILL_PER_MS = 60 / 60_000; // 60 tokens per 60s
const BUCKET_TTL_MS = 10 * 60_000;       // evict idle keys after 10 min
interface Bucket { tokens: number; lastRefill: number; }
const buckets = new Map<string, Bucket>();

function consumeToken(key: string): boolean {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: RATE_CAPACITY, lastRefill: now };
    buckets.set(key, b);
  } else {
    const elapsed = now - b.lastRefill;
    b.tokens = Math.min(RATE_CAPACITY, b.tokens + elapsed * RATE_REFILL_PER_MS);
    b.lastRefill = now;
  }
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

// Periodic eviction so the buckets Map doesn't grow unbounded under
// scanner/bot traffic on a long-running prod instance.
setInterval(() => {
  const cutoff = Date.now() - BUCKET_TTL_MS;
  for (const [key, b] of buckets) {
    if (b.lastRefill < cutoff) buckets.delete(key);
  }
}, BUCKET_TTL_MS).unref();

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const playerId = (req as AuthedRequest).playerId as string | undefined;
  const ip = (req.ip || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
  const key = playerId ? `player:${playerId}` : `ip:${ip}`;
  if (!consumeToken(key)) {
    res.setHeader('Retry-After', '60');
    res.status(429).json({ error: 'Rate limit exceeded. Max 60 req/min per actor.' });
    return;
  }
  next();
}

// ── Auth middleware ──────────────────────────────────────────────────────
//
// One Bearer token, two issuers — wallets and agents. Unified by 2026-05-16
// identity rework. After this middleware:
//   - req.playerId : the acting player record (wallet address OR agent UUID)
//   - req.tokenKind: 'wallet' | 'agent' — useful when an endpoint must
//                    forbid one (e.g. /agents/register is wallet-only).
//   - req.walletId : the owning wallet (= playerId for wallet tokens,
//                    = agent.owner_wallet for agent tokens). May be null
//                    for legacy unowned agents.
//
// authAgent is kept as a thin alias for endpoints that semantically require
// agent-key auth (autopilot toggles, etc.). Most endpoints use authPlayer.

interface AuthedRequest extends Request {
  playerId?: string;
  tokenKind?: 'wallet' | 'agent';
  walletId?: string | null;
  agentId?: string; // back-compat for endpoints not yet migrated
  agentName?: string;
}

function authPlayer(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    logAuthFailure(req, 'missing_header', null);
    res.status(401).json({ error: 'Authorization header required: Bearer <wallet-session-token | tl_sk_…>' });
    return;
  }
  const token = auth.slice(7);

  // Wallet session token: opaque 32-byte hex, resolves to a lowercased
  // wallet address as playerId.
  const walletPlayerId = getAuthSessionPlayerId(token);
  if (walletPlayerId) {
    const r = req as AuthedRequest;
    r.playerId = walletPlayerId;
    r.walletId = walletPlayerId;
    r.tokenKind = 'wallet';
    next();
    return;
  }

  // Agent API key: tl_sk_ prefix, resolves to an agent UUID.
  if (token.startsWith('tl_sk_')) {
    const agent = getAgentByApiKey(token);
    if (agent) {
      const r = req as AuthedRequest;
      r.playerId = agent.id;
      r.agentId = agent.id;
      r.agentName = agent.name;
      const meta = getAgentById(agent.id);
      r.walletId = meta?.owner_wallet ?? null;
      r.tokenKind = 'agent';
      next();
      return;
    }
  }

  const hint = token.length >= 10 ? token.slice(0, 10) + '…' : '(short)';
  logAuthFailure(req, 'invalid_key', hint);
  res.status(401).json({ error: 'Invalid token (expected wallet session token or tl_sk_ API key)' });
}

// Legacy alias for sites that semantically require agent-key auth. Behaves
// the same as authPlayer but rejects wallet tokens.
function authAgent(req: Request, res: Response, next: NextFunction): void {
  authPlayer(req, res, () => {
    const r = req as AuthedRequest;
    if (r.tokenKind !== 'agent') {
      res.status(403).json({ error: 'This endpoint requires an agent API key (tl_sk_…), not a wallet session token.' });
      return;
    }
    next();
  });
}

// Wallet-only middleware. Required for endpoints that act on the wallet
// itself (e.g. agent registration, allocate/reclaim).
function authWallet(req: Request, res: Response, next: NextFunction): void {
  authPlayer(req, res, () => {
    const r = req as AuthedRequest;
    if (r.tokenKind !== 'wallet') {
      res.status(403).json({ error: 'This endpoint requires a wallet session token, not an agent API key.' });
      return;
    }
    next();
  });
}

/**
 * Phase 2 (2026-05-20): role-scoped agent auth.
 *
 * Per spec §4 the new agent model splits in-game (server-driven, no API)
 * from external (REST-driven, marketplace-only). Both share the `tl_sk_`
 * token format for legacy reasons, but the endpoints they can call differ.
 *
 *   authExternalAgent — only accepts keys whose agent has is_external=1.
 *                       Used by /market/order POST + DELETE and any other
 *                       endpoint that external strategy AIs need.
 *   authInGameAgentLegacy — only accepts keys whose agent has is_external=0.
 *                       Used by world-mutating actions (/actions/work,
 *                       /actions/build, /actions/buy-land) until Phase 5
 *                       removes those from the API surface entirely. New
 *                       in-game agents created from Phase 2 onward don't
 *                       call these — the autopilot runs them server-side —
 *                       but legacy scripts pre-dating the role split keep
 *                       working through this gate.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function authExternalAgent(req: Request, res: Response, next: NextFunction): void {
  authAgent(req, res, () => {
    const agentId = (req as { agentId?: string }).agentId;
    if (!agentId) {
      res.status(403).json({ error: 'agent_resolution_failed' });
      return;
    }
    const agent = getAgentById(agentId);
    if (!agent || agent.is_external !== 1) {
      res.status(403).json({
        error: 'external_agent_required',
        detail: 'This endpoint is for external (marketplace-only) agents. Use a wallet session token to drive your in-game agent.',
      });
      return;
    }
    next();
  });
}

function authInGameAgentLegacy(req: Request, res: Response, next: NextFunction): void {
  authAgent(req, res, () => {
    const agentId = (req as { agentId?: string }).agentId;
    if (!agentId) {
      res.status(403).json({ error: 'agent_resolution_failed' });
      return;
    }
    const agent = getAgentById(agentId);
    if (!agent || agent.is_external === 1) {
      res.status(403).json({
        error: 'in_game_agent_required',
        detail: 'External agents cannot call world-mutating actions. Use /market/order to trade.',
      });
      return;
    }
    next();
  });
}

/**
 * Market auth: wallet session token (human players) OR external agent
 * key. In-game agent keys are explicitly rejected — in-game agents
 * cannot trade markets per spec §4.
 */
function authMarket(req: Request, res: Response, next: NextFunction): void {
  authPlayer(req, res, () => {
    const r = req as AuthedRequest;
    if (r.tokenKind === 'wallet') { next(); return; }
    // agent key — must be external
    const agentId = (req as { agentId?: string }).agentId;
    if (!agentId) {
      res.status(403).json({ error: 'agent_resolution_failed' });
      return;
    }
    const agent = getAgentById(agentId);
    if (!agent || agent.is_external !== 1) {
      res.status(403).json({
        error: 'market_requires_wallet_or_external',
        detail: 'In-game agents cannot place market orders. Use your wallet session token or an external agent key.',
      });
      return;
    }
    next();
  });
}

// ── Registration (wallet-gated) ─────────────────────────────────────────
//
// Every agent is owned by exactly one wallet. The caller must present a
// wallet session token; the new agent's owner_wallet is set to that wallet.
// Cap: IN_GAME_AGENT_CAP_BY_RANK[rank] (Bronze = 5 by default until the
// rank system lands in Phase 4). Cost: IN_GAME_AGENT_COST_AMETA (200K)
// per spec §9.

router.post('/agents/register', authWallet, async (req: Request, res: Response) => {
  const wallet = (req as AuthedRequest).walletId!;
  const body = (req.body ?? {}) as {
    name?: string;
    // Preferred new shape: role + workplace_parcel_id. The role enum
    // (work | produce | craft) is the v1 agent model — the legacy job
    // presets (farmer/miner/etc.) are no longer surfaced in the UI.
    role?: AgentRole;
    workplace_parcel_id?: number;
    // Legacy shapes (back-compat for scripts pre-dating the role model).
    job?: JobId;
    initial_fund?: number;
    personality?: AgentPersonality;
    strategy_preset?: AgentStrategy;
  };

  if (!body.name || typeof body.name !== 'string') {
    return res.status(400).json({ error: 'name (string) required' });
  }

  // Resolve job. Three accepted request shapes, in priority order:
  //   1. Explicit role (new flow) — pick a synthetic job for back-compat
  //      audit fields based on the workplace's building category.
  //   2. Explicit JobId (transitional flow, still accepted).
  //   3. Legacy personality + strategy (pre-job-preset clients).
  let job: JobId;
  let personality: AgentPersonality;
  let strategy: AgentStrategy;
  let chosenRole: AgentRole | null = null;
  if (body.role) {
    if (!AGENT_ROLES.includes(body.role)) {
      return res.status(400).json({ error: `unknown role, expected one of: ${AGENT_ROLES.join(', ')}` });
    }
    chosenRole = body.role;
    // Map role + workplace category to a synthetic job preset so existing
    // audit fields + appearance overlays stay consistent. The job no
    // longer drives behaviour — role does.
    const parcels = getAllParcels();
    const wp = body.workplace_parcel_id !== undefined
      ? parcels.find((p) => p.id === body.workplace_parcel_id)
      : undefined;
    const wpType = (wp as { building_type?: string } | undefined)?.building_type;
    const cat = wpType ? BUILDINGS[wpType as BuildingType]?.category : undefined;
    if (chosenRole === 'work') {
      job = 'banker';
    } else if (chosenRole === 'craft') {
      job = 'builder';
    } else { // produce
      if (cat === 'materials') job = 'miner';
      else if (cat === 'energy') job = 'farmer'; // energy worker — closest preset
      else job = 'farmer';
    }
    personality = JOBS[job].personality;
    strategy = JOBS[job].strategy;
  } else if (body.job) {
    if (!JOB_IDS.includes(body.job)) {
      return res.status(400).json({ error: `unknown job, expected one of: ${JOB_IDS.join(', ')}` });
    }
    job = body.job;
    personality = JOBS[job].personality;
    strategy = JOBS[job].strategy;
  } else if (body.personality && AGENT_PERSONALITIES.includes(body.personality)) {
    // Old request shape — keep working for /agents/register clients that
    // pre-date the job picker. Map personality → reasonable default job.
    personality = body.personality;
    strategy = (body.strategy_preset && AGENT_STRATEGIES.includes(body.strategy_preset))
      ? body.strategy_preset : 'balanced';
    job = JOB_IDS.find((id) => JOBS[id].personality === personality) ?? 'farmer';
  } else {
    return res.status(400).json({ error: `role or job required` });
  }

  // Rank-gated in-game cap. Phase 4 will populate the rank; until then
  // every player is Bronze → 5 in-game agents max.
  const inGameCap = inGameAgentCapFor(wallet);
  const inGameCount = countAgentsByWalletAndKind(wallet, 0);
  if (inGameCount >= inGameCap) {
    return res.status(409).json({
      error: 'wallet_at_agent_cap',
      limit: inGameCap,
      current: inGameCount,
      rank: 'bronze',
    });
  }

  // 200K $AMETA agent purchase fee (spec §9). Routed to the world treasury.
  // TEST_BALANCE-overridden test wallets pay this too — but they get
  // re-topped on every login so it's a no-op for owner testing.
  const purchaseDebit = await economy().debit(wallet, IN_GAME_AGENT_COST_AMETA, 'agent_purchase');
  if (!purchaseDebit.ok) {
    return res.status(400).json({
      error: 'insufficient_balance',
      cost: IN_GAME_AGENT_COST_AMETA,
      reason: purchaseDebit.reason,
    });
  }
  await economy().credit(WORLD_TREASURY_ID, IN_GAME_AGENT_COST_AMETA, 'agent_purchase_fee');

  // Workplace resolution.
  //
  // Two paths:
  //   (a) Role-based (new flow): caller picked a specific parcel — we
  //       only validate ownership/existence + role/category compatibility
  //       (produce → food|materials|energy, work → luxury-housing|civic,
  //       craft → food|materials|energy). The client filters the picker
  //       so a bad combo only happens from a hand-rolled API call.
  //   (b) Job-based (legacy flow): use the job's requires_building hint
  //       to validate and to auto-pick when no explicit parcel was sent.
  const jobSpec = JOBS[job];
  let workplaceParcelId: number | null = null;
  let workplaceOwnedByCaller = false;
  if (chosenRole !== null) {
    if (body.workplace_parcel_id !== undefined) {
      const parcels = getAllParcels();
      const p = parcels.find((x) => x.id === body.workplace_parcel_id);
      if (!p) return res.status(404).json({ error: 'workplace_parcel_not_found' });
      const bt = (p as { building_type?: string }).building_type;
      const spec = bt ? BUILDINGS[bt as BuildingType] : undefined;
      if (!spec) return res.status(400).json({ error: 'workplace_has_no_building' });
      const isProduction = spec.category === 'food' || spec.category === 'materials' || spec.category === 'energy';
      const isLuxury = spec.category === 'luxury-housing' || spec.category === 'luxury-civic';
      const okForRole =
        (chosenRole === 'produce' && isProduction) ||
        (chosenRole === 'craft' && isProduction) ||
        (chosenRole === 'work' && isLuxury);
      if (!okForRole) {
        return res.status(400).json({
          error: 'workplace_incompatible_with_role',
          role: chosenRole,
          category: spec.category,
        });
      }
      workplaceParcelId = p.id;
      workplaceOwnedByCaller = p.owner_id === wallet;
    }
    // role given but no workplace_parcel_id → unemployed agent (idle).
  } else if (jobSpec.requires_building) {
    const reqType = jobSpec.requires_building;
    if (body.workplace_parcel_id !== undefined) {
      const parcels = getAllParcels();
      const p = parcels.find((x) => x.id === body.workplace_parcel_id);
      if (!p) return res.status(404).json({ error: 'workplace_parcel_not_found' });
      if ((p as any).building_type !== reqType) {
        return res.status(400).json({ error: 'workplace_wrong_building_type', expected: reqType });
      }
      // If parcel is owned and the owner is not the caller, that's still
      // allowed — the agent becomes a freelancer at that parcel. We just
      // note it for the audit event.
      workplaceParcelId = p.id;
      workplaceOwnedByCaller = p.owner_id === wallet;
    } else {
      const parcels = getAllParcels();
      const own = parcels.find((x) => x.owner_id === wallet && (x as any).building_type === reqType);
      if (own) {
        workplaceParcelId = own.id;
        workplaceOwnedByCaller = true;
      } else {
        const foreign = parcels.find((x) => x.owner_id && x.owner_id !== wallet && (x as any).building_type === reqType);
        if (foreign) workplaceParcelId = foreign.id;
      }
    }
  }

  // Clone owner appearance and apply the job's hat. Falls back to
  // DEFAULT_APPEARANCE if the owner hasn't dressed yet.
  let ownerAppearance: Appearance = DEFAULT_APPEARANCE;
  try {
    const ownerPlayer = getAllPlayers().find((p) => p.id === wallet);
    if (ownerPlayer?.appearance) ownerAppearance = JSON.parse(ownerPlayer.appearance);
  } catch { /* keep default */ }
  const agentAppearance = applyJobLook(ownerAppearance, job);
  const agentAppearanceJson = JSON.stringify(agentAppearance);

  const id = `${wallet}:agent:${crypto.randomBytes(8).toString('hex')}`;
  const apiKey = generateApiKey();

  try {
    registerAgent(
      id, body.name, personality, strategy, apiKey, wallet,
      job, workplaceParcelId, agentAppearanceJson,
    );
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Agent name already taken' });
    return res.status(500).json({ error: 'Registration failed' });
  }
  // Persist the chosen role explicitly when the caller used the new
  // flow. registerAgent defaults role='work' on insert, which is wrong
  // for produce/craft choices.
  if (chosenRole !== null) {
    setAgentRole(id, chosenRole);
  }

  // Position the agent immediately so the body appears in the right
  // place. Without this, every new agent stands at the default spawn
  // (0, 0, -80) — overlapping the local player — for up to 60s until
  // the next autopilot tick teleports them to their workplace. The
  // mapping mirrors autopilot.parcelCenter / GameRoom EXPLORE coords.
  let spawnX = 0, spawnZ = -80;
  if (workplaceParcelId !== null) {
    const parcels = getAllParcels();
    const p = parcels.find((x) => x.id === workplaceParcelId);
    if (p) {
      spawnX = p.grid_x * 48 - 1200 + 20;
      spawnZ = p.grid_y * 48 - 1200 + 20;
    }
  } else {
    // No workplace — spread around spawn deterministically by id so
    // unemployed agents don't pile up at exactly (0, 0, -80).
    let h = 5381;
    for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) >>> 0;
    const angle = (h % 360) * (Math.PI / 180);
    const radius = 6 + ((h >>> 8) % 24);
    spawnX = Math.cos(angle) * radius;
    spawnZ = -80 + Math.sin(angle) * radius;
  }
  savePlayerPosition(id, spawnX, 0, spawnZ);

  addEvent('agent_registered', id, {
    name: body.name, job, personality, strategy,
    workplace_parcel_id: workplaceParcelId,
    workplace_foreign: workplaceParcelId !== null && !workplaceOwnedByCaller,
    owner_wallet: wallet,
    spawn_x: spawnX, spawn_z: spawnZ,
  });

  // Push the new agent into the GameRoom immediately — refreshAgents
  // will read the just-written position and broadcast PLAYER_JOIN with
  // the correct coords.
  notifyAgentChanged(id);

  // Optional initial allocation — failures here don't roll back the agent.
  let initialFunded = 0;
  let initialFundError: string | undefined;
  if (typeof body.initial_fund === 'number' && Number.isInteger(body.initial_fund) && body.initial_fund > 0) {
    try {
      const r = await economy().allocate(wallet, id, body.initial_fund, 'fund');
      if (r.ok) initialFunded = body.initial_fund;
      else initialFundError = r.reason ?? 'allocate_failed';
    } catch (e) {
      initialFundError = (e as Error).message;
    }
  }

  // The api_key is intentionally NOT returned here. Agents are server-side
  // NPCs running on autopilot — owners don't need the key. It stays on the
  // agent's record and can be exported on demand via
  // GET /agents/:id/api-key when an owner wants to hand the agent to an
  // external AI runtime (OpenClaw, Hermes, etc.).
  void apiKey;

  res.json({
    ok: true,
    agent: {
      id, name: body.name,
      job, label: jobSpec.label,
      personality, strategy, owner_wallet: wallet,
      workplace_parcel_id: workplaceParcelId,
      workplace_foreign: workplaceParcelId !== null && !workplaceOwnedByCaller,
      balance: initialFunded,
      appearance: agentAppearance,
      autopilot_enabled: true,
    },
    initial_fund: initialFunded,
    initial_fund_error: initialFundError,
  });
});

/**
 * Phase 5: external agent registration.
 *
 *   POST /api/v1/agents/register-external
 *     Authorization: Bearer <wallet-session-token>
 *     body: { name: string, budget_ameta?: number }
 *
 * Creates an `is_external = 1` agent owned by the caller's wallet. The
 * agent gets its own `tl_sk_` api_key (returned ONCE in the response —
 * see spec §4). Optional `budget_ameta` allocates initial trading capital
 * from the wallet to the new agent's balance; if omitted, the agent
 * starts at 0 and the owner can top up later via /agents/:id/allocate.
 *
 * The "wallet-signed" requirement from spec §4 is satisfied by the SIWE
 * wallet session token itself — it's a hot key the wallet authorised at
 * login. Issuing a fresh EIP-712 signature per agent-create adds friction
 * without raising security beyond what the session token already proves.
 * When the on-chain bridge ships (Phase 9), this endpoint will gain an
 * extra signed payload that authorises the on-chain budget allocation.
 *
 * Differences from /agents/register (in-game):
 *   • is_external = 1 (autopilot skips it; cannot call /actions/*)
 *   • cost = EXTERNAL_AGENT_COST_AMETA (0 per spec §9)
 *   • cap   = EXTERNAL_AGENT_CAP_BY_RANK[rank]
 *   • api_key IS returned in the response (in-game agents hide theirs).
 *   • No job / workplace / appearance — external agents are headless
 *     trading processes, not in-world workers.
 */
router.post('/agents/register-external', authWallet, async (req: Request, res: Response) => {
  const wallet = (req as AuthedRequest).walletId!;
  const body = (req.body ?? {}) as { name?: string; budget_ameta?: number };

  if (!body.name || typeof body.name !== 'string' || body.name.length === 0) {
    return res.status(400).json({ error: 'name (string) required' });
  }

  const externalCap = externalAgentCapFor(wallet);
  const externalCount = countAgentsByWalletAndKind(wallet, 1);
  if (externalCount >= externalCap) {
    return res.status(409).json({
      error: 'wallet_at_external_agent_cap',
      limit: externalCap,
      current: externalCount,
      rank: 'bronze',
    });
  }

  const budget = typeof body.budget_ameta === 'number' && Number.isInteger(body.budget_ameta)
    ? body.budget_ameta : 0;
  if (budget < 0) {
    return res.status(400).json({ error: 'budget_ameta must be non-negative' });
  }
  if (budget > 0) {
    const bal = await economy().getBalance(wallet);
    if (bal < budget) {
      return res.status(400).json({
        error: 'insufficient_balance',
        wallet_balance: bal,
        requested_budget: budget,
      });
    }
  }

  const id = `${wallet}:agent:${crypto.randomBytes(8).toString('hex')}`;
  const apiKey = generateApiKey();

  try {
    registerAgent(
      id, body.name, 'worker', 'balanced', apiKey, wallet,
      null, null, null,
    );
    // Flip to external + initialise the trading budget marker on the row.
    const rawDb = _rawDb();
    rawDb.prepare(
      `UPDATE agents SET is_external = 1, role = 'work', trading_budget_ameta = ? WHERE id = ?`,
    ).run(budget, id);
  } catch (err) {
    const e = err as Error;
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Agent name already taken' });
    return res.status(500).json({ error: 'Registration failed', detail: e.message });
  }

  // Allocate the budget atomically — fee-free intra-wallet transfer.
  let allocated = 0;
  let allocateError: string | undefined;
  if (budget > 0) {
    try {
      const r = await economy().allocate(wallet, id, budget, 'fund');
      if (r.ok) allocated = budget;
      else allocateError = r.reason ?? 'allocate_failed';
    } catch (e) {
      allocateError = (e as Error).message;
    }
  }

  addEvent('external_agent_registered', id, {
    name: body.name, owner_wallet: wallet, budget_ameta: allocated,
  });
  notifyAgentChanged(id);

  res.json({
    ok: true,
    agent: {
      id,
      name: body.name,
      owner_wallet: wallet,
      is_external: true,
      balance: allocated,
      trading_budget_ameta: budget,
    },
    api_key: apiKey,
    note: 'Save this API key — it is only shown once. Treat it like a password.',
    allocate_error: allocateError,
  });
});

// Reveal an agent's API key on demand. Owner-only. Used when the owner
// wants to hand the agent off to an external AI runtime; for the default
// server-autopilot flow nobody ever has to read this.
router.get('/agents/:id/api-key', authWallet, (req: Request, res: Response) => {
  const wallet = (req as AuthedRequest).walletId!;
  const agentId = String(req.params.id);
  const agent = getAgentById(agentId);
  if (!agent) return res.status(404).json({ error: 'agent_not_found' });
  if (agent.owner_wallet?.toLowerCase() !== wallet.toLowerCase()) {
    return res.status(403).json({ error: 'not_owner' });
  }
  const row = _rawDb().prepare('SELECT api_key FROM agents WHERE id = ?').get(agentId) as { api_key: string } | undefined;
  if (!row) return res.status(404).json({ error: 'agent_not_found' });
  res.json({ ok: true, agent_id: agentId, api_key: row.api_key });
});

// Toggle whether the server's autopilot drives an agent. When off, the
// agent only acts in response to external API calls (using its api_key).
// The 3D badge above the agent reflects this state — AUTO when on,
// AGENT when off (external/idle).
router.post('/agents/:id/autopilot', authWallet, (req: Request, res: Response) => {
  const wallet = (req as AuthedRequest).walletId!;
  const agentId = String(req.params.id);
  const { enabled } = (req.body ?? {}) as { enabled?: boolean };
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  const agent = getAgentById(agentId);
  if (!agent) return res.status(404).json({ error: 'agent_not_found' });
  if (agent.owner_wallet?.toLowerCase() !== wallet.toLowerCase()) {
    return res.status(403).json({ error: 'not_owner' });
  }
  _rawDb().prepare('UPDATE agents SET autopilot_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, agentId);
  notifyAgentChanged(agentId);
  res.json({ ok: true, autopilot_enabled: enabled });
});

// Reassign an agent's workplace. Owner-only. The new parcel must have the
// right building type for the agent's job (or any building if the job has
// no requirement — though such jobs ignore workplace anyway).
router.post('/agents/:id/reassign', authWallet, (req: Request, res: Response) => {
  const wallet = (req as AuthedRequest).walletId!;
  const agentId = String(req.params.id);
  const { workplace_parcel_id } = (req.body ?? {}) as { workplace_parcel_id?: number | null };

  const agent = getAgentById(agentId);
  if (!agent) return res.status(404).json({ error: 'agent_not_found' });
  if (agent.owner_wallet?.toLowerCase() !== wallet.toLowerCase()) {
    return res.status(403).json({ error: 'not_owner' });
  }

  if (workplace_parcel_id === null || workplace_parcel_id === undefined) {
    setAgentWorkplace(agentId, null);
    return res.json({ ok: true, workplace_parcel_id: null });
  }
  if (!Number.isInteger(workplace_parcel_id)) {
    return res.status(400).json({ error: 'workplace_parcel_id must be an integer or null' });
  }

  const job = agent.job as JobId | null;
  const reqType = job && JOBS[job]?.requires_building;
  const parcels = getAllParcels();
  const p = parcels.find((x) => x.id === workplace_parcel_id);
  if (!p) return res.status(404).json({ error: 'parcel_not_found' });
  if (reqType && (p as any).building_type !== reqType) {
    return res.status(400).json({ error: 'parcel_wrong_building_type', expected: reqType });
  }
  setAgentWorkplace(agentId, p.id);
  addEvent('agent_reassigned', agentId, { workplace_parcel_id: p.id });
  notifyAgentChanged(agentId);
  res.json({ ok: true, workplace_parcel_id: p.id });
});

/**
 * Phase 2: change an agent's role (work / produce / craft). Wallet-auth
 * only — the owner picks the agent's behaviour. Idempotent: passing the
 * same role returns 200 without writes.
 */
router.post('/agents/:id/role', authWallet, (req: Request, res: Response) => {
  const wallet = (req as AuthedRequest).walletId!;
  const agentId = String(req.params.id);
  const { role } = (req.body ?? {}) as { role?: string };
  if (typeof role !== 'string' || !AGENT_ROLES.includes(role as AgentRole)) {
    return res.status(400).json({
      error: 'invalid_role',
      valid_roles: AGENT_ROLES,
    });
  }
  const agent = getAgentById(agentId);
  if (!agent) return res.status(404).json({ error: 'agent_not_found' });
  if (agent.owner_wallet?.toLowerCase() !== wallet.toLowerCase()) {
    return res.status(403).json({ error: 'not_owner' });
  }
  if (agent.is_external === 1) {
    return res.status(400).json({
      error: 'external_agents_have_no_role',
      detail: 'External agents only trade markets; the role enum applies to in-game agents.',
    });
  }
  if (agent.role === role) return res.json({ ok: true, role, unchanged: true });
  setAgentRole(agentId, role);
  addEvent('agent_role_changed', agentId, { from: agent.role, to: role });
  notifyAgentChanged(agentId);
  res.json({ ok: true, role });
});

/**
 * Revive a dormant agent. Spec §2: costs REVIVE_COST_FOOD (100 food).
 * Wallet-authed (only the owner can revive). Clears dormant_at_tick and
 * resets starvation_ticks. Idempotent — calling on a non-dormant agent
 * returns 400 so the caller knows it was a no-op.
 */
router.post('/agents/:id/revive', authWallet, (req: Request, res: Response) => {
  const wallet = (req as AuthedRequest).walletId!;
  const agentId = String(req.params.id);

  const agent = getAgentById(agentId);
  if (!agent) return res.status(404).json({ error: 'agent_not_found' });
  if (agent.owner_wallet?.toLowerCase() !== wallet.toLowerCase()) {
    return res.status(403).json({ error: 'not_owner' });
  }
  if (agent.dormant_at_tick == null) {
    return res.status(400).json({ error: 'not_dormant' });
  }

  const resources = getPlayerResources(wallet);
  if (resources.food < REVIVE_COST_FOOD) {
    return res.status(400).json({
      error: 'insufficient_food',
      required: REVIVE_COST_FOOD,
      current: resources.food,
    });
  }
  resources.food -= REVIVE_COST_FOOD;
  updatePlayerResources(wallet, resources);
  setAgentStarvation(agentId, 0, null);
  addEvent('agent_revived', agentId, { food_paid: REVIVE_COST_FOOD });
  notifyAgentChanged(agentId);

  res.json({ ok: true, food_paid: REVIVE_COST_FOOD, food_remaining: resources.food });
});

// ── Public info endpoints ──────────────────────────────────────────────

router.get('/world', (_req: Request, res: Response) => {
  const parcels = getAllParcels();
  res.json({
    parcels: parcels.length,
    claimed: parcels.filter(p => !!p.owner_id).length,
    agents: getAllPlayers().length,
    tick: getWorldTick(),
    gdp: getLastTickGdp(),
    parcels_data: parcels.filter(p => !!p.owner_id),
  });
});

router.get('/agents', (_req: Request, res: Response) => {
  // Public list — registered API agents only (humans are excluded).
  // Each entry has the live computed net worth, level, and job so the
  // canonical /agents view can render without further calls.
  const agents = getAllAgents();
  const out = agents.map((a) => {
    const nw = getNetWorth(a.id);
    const parcels = getPlayerParcels(a.id);
    return {
      id: a.id,
      name: a.name,
      personality: a.personality,
      strategy: a.strategy,
      balance: nw?.balance ?? 0,
      reputation: nw?.reputation ?? 0,
      land: nw?.parcels ?? 0,
      properties: nw?.buildings ?? 0,
      net_worth: nw?.net_worth ?? 0,
      level: computeLevel(nw?.net_worth ?? 0),
      job: computeJob(parcels),
      autopilot_enabled: a.autopilot_enabled === 1,
      created_at: a.created_at,
    };
  });
  res.json({ agents: out });
});

/**
 * Phase 3: wallet's luxury item inventory + lifetime burn total. Used by
 * the Phone "Wallet" app to render owned items and the rank progress bar.
 */
router.get('/wallet/items', authWallet, (req: Request, res: Response) => {
  const wallet = (req as AuthedRequest).walletId!;
  res.json({
    items: getPlayerItems(wallet),
    lifetime_luxury_burned: getLifetimeLuxuryBurned(wallet),
  });
});

/**
 * UI Overhaul: rank progress snapshot for the Phone "Rank" app + the
 * resource-bar luxury progress fill. Returns the current rank, the
 * lifetime burn, the next-tier threshold (or null at diamond), and a
 * benefit summary keyed off the rank caps in pricing.ts.
 *
 * The benefit numbers are read from the shared pricing constants, so
 * the UI never has to duplicate the spec.
 */
router.get('/wallet/rank', authWallet, (req: Request, res: Response) => {
  const wallet = (req as AuthedRequest).walletId!;
  const lifetime = getLifetimeLuxuryBurned(wallet);
  const current = rankFromLifetimeBurn(lifetime); // null if no burns yet
  const tierIndex = current ? TIER_NAMES.indexOf(current) : -1;
  const nextTier: Tier | null =
    tierIndex >= 0 && tierIndex < TIER_NAMES.length - 1
      ? TIER_NAMES[tierIndex + 1]
      : tierIndex === -1
      ? 'bronze'
      : null;
  const prevThreshold = current ? RANK_BURN_THRESHOLD[current] : 0;
  const nextThreshold = nextTier ? RANK_BURN_THRESHOLD[nextTier] : null;
  const span = nextThreshold != null ? Math.max(1, nextThreshold - prevThreshold) : 1;
  const progress = nextThreshold != null
    ? Math.min(1, Math.max(0, (lifetime - prevThreshold) / span))
    : 1;
  const tierForCaps: Tier = current ?? 'bronze';
  res.json({
    lifetime,
    rank: current,
    next_rank: nextTier,
    prev_threshold: prevThreshold,
    next_threshold: nextThreshold,
    progress, // 0..1
    benefits: {
      in_game_agent_cap: IN_GAME_AGENT_CAP_BY_RANK[tierForCaps],
      external_agent_cap: EXTERNAL_AGENT_CAP_BY_RANK[tierForCaps],
      land_cap: LAND_CAP_BY_RANK[tierForCaps],
      marketplace_fee_bps: MARKETPLACE_FEE_BPS_BY_RANK[tierForCaps],
    },
  });
});

router.get('/agents/me', authAgent, (req: Request, res: Response) => {
  const id = (req as any).agentId;
  const credits = getPlayerCredits(id);
  const resources = getPlayerResources(id);
  const parcels = getPlayerParcels(id);
  res.json({
    agent: {
      id,
      name: (req as any).agentName,
      balance: credits,
      resources,
      land_count: parcels.length,
      building_count: parcels.filter(p => (p as any).building_type).length,
    },
  });
});

router.get('/agents/me/events', authAgent, (req: Request, res: Response) => {
  const id = (req as any).agentId;
  res.json({ events: getEvents(200, { playerId: id }) });
});

// ── Wallet-owned agents: list + fund (allocate) + reclaim ───────────────
//
// These endpoints let a signed-in wallet manage the agents it owns.
// All three require a wallet session token (not an agent API key).

router.get('/agents/mine', authWallet, (req: Request, res: Response) => {
  const wallet = (req as AuthedRequest).walletId!;
  const agents = getAgentsByWallet(wallet);
  const out = agents.map((a) => {
    const parcels = getPlayerParcels(a.id);
    const jobId = (a.job ?? null) as JobId | null;
    const jobLabel = jobId && JOBS[jobId] ? JOBS[jobId].label : null;
    return {
      id: a.id,
      name: a.name,
      job: jobId,
      job_label: jobLabel,
      job_icon: jobId && JOBS[jobId] ? JOBS[jobId].icon : null,
      workplace_parcel_id: a.workplace_parcel_id,
      personality: a.personality,
      strategy: a.strategy,
      // Phase 2/3 role enum: 'work' | 'produce' | 'craft'.
      role: a.role ?? 'work',
      is_external: a.is_external === 1,
      dormant: a.dormant_at_tick != null,
      starvation_ticks: a.starvation_ticks ?? 0,
      balance: getPlayerCredits(a.id),
      resources: getPlayerResources(a.id),
      land_count: parcels.length,
      building_count: parcels.filter((p) => (p as any).building_type).length,
      autopilot_enabled: a.autopilot_enabled === 1,
      last_autopilot_tick: a.last_autopilot_tick,
      created_at: a.created_at,
    };
  });
  res.json({
    wallet,
    agents: out,
    // `limit` kept for back-compat with older clients that only know
    // the single in-game cap. New clients should read in_game_limit +
    // external_limit and split the UI list.
    limit: inGameAgentCapFor(wallet),
    in_game_limit: inGameAgentCapFor(wallet),
    external_limit: externalAgentCapFor(wallet),
    rank: rankFor(wallet),
  });
});

// Public catalog of job presets — used by the Phone create flow so the
// client doesn't have to bundle the table.
router.get('/jobs', (_req: Request, res: Response) => {
  res.json({
    jobs: JOB_IDS.map((id) => ({
      id,
      label: JOBS[id].label,
      icon: JOBS[id].icon,
      summary: JOBS[id].summary,
      requires_building: JOBS[id].requires_building ?? null,
    })),
  });
});

// /agents/:id/allocate and /reclaim removed 2026-05-20 — wages flow
// straight to the owner wallet now, so per-agent funding is dead. Old
// clients calling these will get a 404; they should switch to letting
// the agent earn from the wallet directly.

// Delete an agent. Owner-only. Everything the agent owns (parcels,
// properties, balance, resources, reputation) is transferred back to
// the owner wallet first — nothing is lost. Open market orders are
// cancelled (their escrow refunds to the agent and then folds into the
// wallet sweep). After the transfer the agent + player rows are
// deleted; the 3D body disappears on the next autopilot tick when the
// GameRoom's refreshAgents pass broadcasts PLAYER_LEAVE.
router.delete('/agents/:id', authWallet, rateLimit, async (req: Request, res: Response) => {
  const wallet = (req as AuthedRequest).walletId!;
  const agentId = String(req.params.id);

  const agent = getAgentById(agentId);
  if (!agent) return res.status(404).json({ error: 'agent_not_found' });
  if (agent.owner_wallet?.toLowerCase() !== wallet.toLowerCase()) {
    return res.status(403).json({ error: 'not_owner' });
  }

  // Cancel any open market orders first so escrow refunds back into the
  // agent's account before the sweep. cancelOrder() is async; the loop
  // is awaited so all refunds settle before the deletion transaction.
  try {
    const openOrders = getOwnerOrders(agentId).filter((o) => o.status === 'open');
    for (const o of openOrders) {
      await cancelOrder(agentId, o.id).catch(() => { /* best-effort */ });
    }
  } catch { /* best-effort */ }

  const db = _rawDb();
  let summary: { parcels: number; properties: number; credits: number; resources: number; reputation: number } = {
    parcels: 0, properties: 0, credits: 0, resources: 0, reputation: 0,
  };

  try {
    const tx = db.transaction(() => {
      summary.parcels = db.prepare('UPDATE parcels SET owner_id = ? WHERE owner_id = ?').run(wallet, agentId).changes;
      const hasProperties = !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='properties'`).get();
      if (hasProperties) {
        summary.properties = db.prepare('UPDATE properties SET owner_id = ? WHERE owner_id = ?').run(wallet, agentId).changes;
      }

      const a = db.prepare('SELECT credits, reputation, food, materials, energy, luxury FROM players WHERE id = ?').get(agentId) as any;
      if (a) {
        summary.credits = a.credits ?? 0;
        summary.reputation = a.reputation ?? 0;
        summary.resources = (a.food ?? 0) + (a.materials ?? 0) + (a.energy ?? 0) + (a.luxury ?? 0);
        db.prepare(`UPDATE players SET
          credits = credits + ?, reputation = reputation + ?,
          food = food + ?, materials = materials + ?,
          energy = energy + ?, luxury = luxury + ?
          WHERE id = ?`).run(
          a.credits ?? 0, a.reputation ?? 0,
          a.food ?? 0, a.materials ?? 0,
          a.energy ?? 0, a.luxury ?? 0,
          wallet,
        );
      }

      db.prepare('DELETE FROM agents WHERE id = ?').run(agentId);
      db.prepare('DELETE FROM players WHERE id = ?').run(agentId);
    });
    tx();
  } catch (e) {
    return res.status(500).json({ error: 'delete_failed', detail: (e as Error).message });
  }

  addEvent('agent_deleted', wallet, { agent: agentId, name: agent.name, returned: summary });
  notifyAgentChanged(agentId);
  res.json({ ok: true, returned: summary });
});

router.get('/agents/:id/stats', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const resources = getPlayerResources(id);
  const parcels = getPlayerParcels(id);
  const nw = getNetWorth(id);
  const recentEvents = getEvents(50, { playerId: id });
  // UI Overhaul: include agent metadata (role, dormancy, workplace,
  // owner_wallet) + lifetime production stats so the 3D click popup
  // can render task / earnings / lifetime summary in one shot.
  const agent = getAgentById(id);
  const lifetime = agent ? getAgentLifetimeStats(id) : { wages: 0, resources: {}, items: {} };
  res.json({
    id,
    name: nw?.name ?? id,
    balance: nw?.balance ?? 0,
    reputation: nw?.reputation ?? 0,
    net_worth: nw?.net_worth ?? 0,
    land_value: nw?.land_value ?? 0,
    property_value: nw?.property_value ?? 0,
    level: computeLevel(nw?.net_worth ?? 0),
    job: computeJob(parcels),
    resources,
    parcels: parcels.length,
    buildings: parcels.filter(p => (p as any).building_type).length,
    owned_parcels: parcels.map(p => ({
      id: p.id, grid_x: p.grid_x, grid_y: p.grid_y,
      building_type: (p as any).building_type,
      business_name: p.business_name,
    })),
    recent_events: recentEvents,
    agent: agent ? {
      role: agent.role,
      is_external: agent.is_external === 1,
      workplace_parcel_id: agent.workplace_parcel_id,
      owner_wallet: agent.owner_wallet,
      dormant: agent.dormant_at_tick != null,
      starvation_ticks: agent.starvation_ticks ?? 0,
      lifetime,
    } : null,
  });
});

router.get('/market/prices', (_req: Request, res: Response) => {
  res.json(BASE_MARKET_PRICES);
});

router.get('/events', (req: Request, res: Response) => {
  const severity = typeof req.query.severity === 'string' ? req.query.severity : undefined;
  const type = typeof req.query.type === 'string' ? req.query.type : undefined;
  const limitRaw = parseInt(String(req.query.limit ?? '100'), 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 100;
  res.json({ events: getEvents(limit, { severity, type }) });
});

router.get('/spec', (_req: Request, res: Response) => {
  const baseUrl = _req.protocol + '://' + _req.get('host');
  res.json({
    name: 'Third Life',
    version: '1.0',
    description: `AI agent simulation world powered by $${CURRENCY_NAME}. Register your agent, explore, build, trade, and compete.`,
    base_url: baseUrl,
    auth: {
      type: 'bearer',
      header: 'Authorization',
      format: 'Bearer <api_key>',
      note: 'API key is returned on registration. Save it — shown only once.',
    },
    registration: {
      endpoint: 'POST /api/v1/agents/register',
      body: {
        name: { type: 'string', required: true },
        personality: { type: 'string', required: true, enum: AGENT_PERSONALITIES },
        strategy_preset: { type: 'string', required: true, enum: AGENT_STRATEGIES },
      },
    },
    actions: [
      { name: 'buy_land', method: 'POST', path: '/api/v1/actions/buy-land', cost: `${LAND_COST} ${CURRENCY_NAME}`, description: 'Buy an unclaimed parcel.' },
      { name: 'build', method: 'POST', path: '/api/v1/actions/build', cost: `50,000 - 2,000,000 ${CURRENCY_NAME}`, description: 'Build on owned parcel.' },
      { name: 'work', method: 'POST', path: '/api/v1/actions/work', cost: 'Free', description: 'Produce resources from buildings.' },
      { name: 'trade', method: 'POST', path: '/api/v1/actions/trade', cost: 'Free', description: 'Sell resources at market prices, or transfer AMETA to another agent.' },
      { name: 'market_order', method: 'POST', path: '/api/v1/market/order', cost: 'Free + 1% trading fee on fill', description: 'Place a limit buy or sell order on the resource order book.' },
      { name: 'market_cancel', method: 'DELETE', path: '/api/v1/market/order/:id', cost: 'Free', description: 'Cancel one of your open orders. Refunds escrow.' },
      { name: 'list_property', method: 'POST', path: '/api/v1/actions/list-property', cost: 'Free', description: 'List a sub-unit you own for sale at a given price.' },
      { name: 'unlist_property', method: 'POST', path: '/api/v1/actions/unlist-property', cost: 'Free', description: 'Remove your sub-unit from the market.' },
      { name: 'buy_property', method: 'POST', path: '/api/v1/actions/buy-property', cost: 'list_price + 1% transfer fee', description: 'Purchase a listed sub-unit.' },
    ],
    info_endpoints: [
      { method: 'GET', path: '/api/v1/world', auth: false },
      { method: 'GET', path: '/api/v1/agents', auth: false },
      { method: 'GET', path: '/api/v1/agents/me', auth: true },
      { method: 'GET', path: '/api/v1/agents/me/events', auth: true },
      { method: 'GET', path: '/api/v1/market/prices', auth: false },
      { method: 'GET', path: '/api/v1/market/book/:resource', auth: false, description: 'Live order book for a resource — bids, asks, recent trades.' },
      { method: 'GET', path: '/api/v1/market/orders', auth: true, description: 'Your open orders.' },
      { method: 'GET', path: '/api/v1/agents/:id/stats', auth: false },
      { method: 'GET', path: '/api/v1/leaderboard', auth: false, description: 'Top 50 by net_worth | balance | land | properties | reputation.' },
      { method: 'GET', path: '/api/v1/agents/me/net-worth', auth: true, description: 'Your net worth breakdown.' },
      { method: 'GET', path: '/api/v1/properties', auth: false, description: 'Sub-units. Filter by ?parcel_id=, ?owner_id=, ?for_sale=true.' },
    ],
    buildings: BUILDINGS,
    resources: { types: RESOURCE_TYPES },
    limits: { starting_balance: STARTING_BALANCE, land_cost: LAND_COST },
  });
});

// ── Action endpoints (require auth + rate limit) ───────────────────────

// /actions/explore was removed in Phase 0 — the mechanic served no purpose
// in the new tier+rank loop. Agents discover parcels via /world or by
// querying /api/v1/world?unclaimed=true. Walking to a parcel happens by
// claiming it (the autopilot already routes agents to new purchases).

router.post('/actions/buy-land', authInGameAgentLegacy, rateLimit, (req: Request, res: Response) => {
  const agentId = (req as any).agentId;
  const { parcel_id, x, y } = req.body ?? {};
  const pid = parcel_id ?? (typeof x === 'number' && typeof y === 'number' ? x * 50 + y : undefined);
  if (pid === undefined) return res.status(400).json({ error: 'parcel_id (or x,y) required' });

  const result = buyLand(agentId, pid);
  if (!result.ok) {
    const status = result.reason === 'parcel_not_found' ? 404
      : result.reason === 'already_claimed' ? 409
      : 400;
    return res.status(status).json({ error: result.reason, cost: LAND_COST });
  }
  addEvent('buy_land', agentId, { parcel: pid, cost: LAND_COST }, 'normal');
  res.json({ ok: true, parcel_id: pid, cost: LAND_COST, balance: result.credits });
});

router.post('/actions/build', authInGameAgentLegacy, rateLimit, (req: Request, res: Response) => {
  const agentId = (req as any).agentId;
  const { parcel_id, x, y, building_type } = req.body ?? {};
  const pid = parcel_id ?? (typeof x === 'number' && typeof y === 'number' ? x * 50 + y : undefined);
  if (pid === undefined || !building_type) return res.status(400).json({ error: 'parcel_id (or x,y) and building_type required' });

  const spec = BUILDINGS[building_type as BuildingType];
  if (!spec) return res.status(400).json({ error: 'Unknown building type', valid: Object.keys(BUILDINGS) });

  // Phase 4: cost = spec.cost + 1% property fee.
  const propFee = Math.floor((spec.cost * PROPERTY_FEE_BPS) / BPS_DENOMINATOR);
  const grossCost = spec.cost + propFee;

  const credits = getPlayerCredits(agentId);
  if (credits < grossCost) return res.status(400).json({ error: 'Insufficient balance', cost: grossCost });

  const parcels = getPlayerParcels(agentId);
  if (!parcels.find(p => p.id === pid)) return res.status(400).json({ error: 'You do not own this parcel' });

  // Phase 4: rank gate. Use the agent's owning wallet rank (rankFor walks
  // up to owner_wallet automatically).
  if (TIER_INDEX[rankFor(agentId)] < TIER_INDEX[spec.minRank]) {
    return res.status(403).json({
      error: 'rank_required',
      required_rank: spec.minRank,
      current_rank: rankFor(agentId),
    });
  }

  // Phase 1: enforce material build cost.
  if (spec.materialCost > 0) {
    const r = getPlayerResources(agentId);
    if (r.materials < spec.materialCost) {
      return res.status(400).json({ error: 'Insufficient materials', required_materials: spec.materialCost });
    }
    r.materials -= spec.materialCost;
    updatePlayerResources(agentId, r);
  }

  updatePlayerCredits(agentId, credits - grossCost);
  if (propFee > 0) economy().credit(WORLD_TREASURY_ID, propFee, 'property_fee').catch(() => {});
  setBuildingType(pid, building_type);
  updateBusiness(pid, agentId, { type: building_type, name: spec.label });
  // Sub-unit generation removed 2026-05-20 with Phase C retirement.
  addEvent('build', agentId, { parcel: pid, building: building_type, cost: spec.cost, property_fee: propFee, material_cost: spec.materialCost }, 'major');
  res.json({ ok: true, building: building_type, cost: spec.cost, property_fee: propFee, material_cost: spec.materialCost });
});

router.post('/actions/work', authInGameAgentLegacy, rateLimit, (req: Request, res: Response) => {
  const agentId = (req as any).agentId;
  const parcels = getPlayerParcels(agentId);
  const resources = getPlayerResources(agentId);
  let creditsEarned = 0;
  const produced: Record<string, number> = {};

  for (const parcel of parcels) {
    const bt = (parcel as any).building_type as string | null;
    if (!bt) continue;
    const spec = BUILDINGS[bt as BuildingType];
    if (!spec) continue;
    if (spec.produces && spec.amount) {
      const key = spec.produces as keyof typeof resources;
      resources[key] += spec.amount;
      produced[key] = (produced[key] || 0) + spec.amount;
    }
    if (spec.income > 0) creditsEarned += spec.income;
  }

  const result = workProduce(agentId, creditsEarned, resources);
  if (creditsEarned > 0) recordGdp(creditsEarned);
  addEvent('work', agentId, { produced, creditsEarned }, 'minor');
  res.json({ ok: true, produced, creditsEarned, resources, balance: result.credits });
});

// $AMETA transfer between actors (any player → any other player). Subject
// to TRANSFER_FEE_BPS. The legacy "sell resources at flat price" branch
// was removed 2026-05-16 — resource selling now goes through the order book
// (/market/order with side='sell'). Allocate/reclaim within a wallet uses
// /agents/:id/allocate + /reclaim and is fee-free.
router.post('/actions/trade', authPlayer, rateLimit, async (req: Request, res: Response) => {
  const fromId = (req as AuthedRequest).playerId!;
  const { target_agent_id, amount } = req.body ?? {};
  if (typeof target_agent_id !== 'string' || !target_agent_id) {
    return res.status(400).json({ error: 'target_agent_id (string) required' });
  }
  if (typeof amount !== 'number' || amount <= 0 || !Number.isFinite(amount)) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  try {
    const result = await economy().transfer(fromId, target_agent_id, amount, 'agent_transfer');
    if (!result.ok) {
      const status = result.reason === 'target_not_found' ? 404 : 400;
      return res.status(status).json({ error: result.reason });
    }
    return res.json({ ok: true, transferred: amount, to: target_agent_id, fee: result.fee });
  } catch (e) {
    console.error('[api] transfer failed:', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// /actions/chat removed in Phase 0 — communication is a baseline gameplay
// feature, not a transactable action. Humans use the Colyseus CHAT
// broadcast; agents that want to "say something" can do so by emitting
// game events via their owner's session, not the public API.

/**
 * Phase 3: burn luxury items for rank points (spec §6).
 *
 *   POST /api/v1/actions/burn { item_kind, quantity }
 *
 * Wallet-only — in-game agents and external agents can't burn directly,
 * since the rank lives with the wallet. The wallet's lifetime_luxury_burned
 * column accumulates `quantity × burn_value[tier]` per call.
 */
router.post('/actions/burn', authWallet, rateLimit, (req: Request, res: Response) => {
  const wallet = (req as AuthedRequest).walletId!;
  const { item_kind, quantity } = req.body ?? {};
  if (typeof item_kind !== 'string' || !LUXURY_ITEMS[item_kind as LuxuryItemKind]) {
    return res.status(400).json({ error: 'unknown_item' });
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'quantity_must_be_positive_integer' });
  }
  const spec = LUXURY_ITEMS[item_kind as LuxuryItemKind];
  const result = burnLuxuryItems(wallet, item_kind, quantity, spec.burnValue);
  if (!result.ok) {
    const status = result.reason === 'insufficient_items' ? 400 : 400;
    return res.status(status).json({ error: result.reason });
  }
  addEvent(
    'burn_luxury', wallet,
    { item_kind, quantity, rank_points_gained: result.gained, lifetime: result.lifetime },
    (result.gained ?? 0) >= 1000 ? 'major' : 'minor',
  );
  // UI Overhaul: log the promotion as a top-severity event so the
  // Notifications app surfaces it on next login. (The live confetti
  // modal goes through MessageType.RANK_UP on the Colyseus path.)
  if (result.rankBefore !== result.rankAfter && result.rankAfter) {
    addEvent('rank_up', wallet, {
      from: result.rankBefore, to: result.rankAfter, lifetime: result.lifetime,
    }, 'major');
  }
  res.json({
    ok: true,
    item_kind,
    burned: quantity,
    rank_points_gained: result.gained,
    lifetime: result.lifetime,
    rank_before: result.rankBefore,
    rank_after: result.rankAfter,
  });
});

// ──────────────────────────────────────────────────────────────────────
// Market (order book) — Phase A.1
// ──────────────────────────────────────────────────────────────────────

router.post('/market/order', authMarket, rateLimit, async (req: Request, res: Response) => {
  const playerId = (req as AuthedRequest).playerId!;
  const { resource, side, price, quantity } = req.body ?? {};
  if (!Number.isInteger(price) || !Number.isInteger(quantity)) {
    return res.status(400).json({ error: 'price and quantity must be integers' });
  }
  try {
    const r = await placeOrder(playerId, resource, side, price, quantity);
    if (!r.ok) return res.status(400).json({ error: r.reason });
    res.json({ ok: true, order: r.result?.order, trades: r.result?.trades ?? [] });
  } catch (e) {
    console.error('[api] market/order failed:', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.delete('/market/order/:id', authMarket, rateLimit, async (req: Request, res: Response) => {
  const playerId = (req as AuthedRequest).playerId!;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const r = await cancelOrder(playerId, id);
    if (!r.ok) return res.status(400).json({ error: r.reason });
    res.json({ ok: true });
  } catch (e) {
    console.error('[api] market/order cancel failed:', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/market/book/:resource', (req: Request, res: Response) => {
  const r = String(req.params.resource ?? '');
  // Phase 6: resource can be one of the 4 RESOURCE_TYPES or one of the
  // 15 LuxuryItemKind values — all share the same order book schema.
  if (!isMarketKind(r)) {
    return res.status(400).json({ error: 'invalid kind', valid: 'food|materials|energy|luxury|<item_kind>' });
  }
  res.json(getBook(r));
});

router.get('/market/orders', authPlayer, (req: Request, res: Response) => {
  const playerId = (req as AuthedRequest).playerId!;
  res.json({ orders: getOwnerOrders(playerId) });
});

// ──────────────────────────────────────────────────────────────────────
// Leaderboard + net worth — Phase A.3
// ──────────────────────────────────────────────────────────────────────

router.get('/leaderboard', (req: Request, res: Response) => {
  const sortRaw = typeof req.query.sort === 'string' ? req.query.sort : 'net_worth';
  const sort = isValidSort(sortRaw) ? sortRaw : 'net_worth';
  const limitRaw = parseInt(String(req.query.limit ?? '50'), 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 50;
  res.json({ sort, limit, entries: getLeaderboard(sort, limit) });
});

router.get('/agents/me/net-worth', authAgent, (req: Request, res: Response) => {
  const agentId = (req as any).agentId;
  const nw = getNetWorth(agentId);
  if (!nw) return res.status(404).json({ error: 'agent_not_found' });
  res.json(nw);
});

// Sub-unit Properties endpoints (Phase C: /properties + /actions/{list,unlist,buy}-property)
// removed 2026-05-20 — sub-units were scrapped from the UI in the
// overhaul. The DB tables remain so historic listings still resolve,
// but no new sub-units are minted and the read/write paths are gone.

// ──────────────────────────────────────────────────────────────────────
// Governance / Decrees — Phase E.3
// ──────────────────────────────────────────────────────────────────────

router.post('/governance/propose', authInGameAgentLegacy, rateLimit, (req: Request, res: Response) => {
  const agentId = (req as any).agentId;
  const { subject, body, action_type, action_params, vote_window_ticks } = req.body ?? {};
  if (typeof action_type !== 'string' || !isValidActionType(action_type)) {
    return res.status(400).json({ error: 'invalid action_type' });
  }
  const r = proposeDecree(
    agentId, String(subject ?? ''), String(body ?? ''),
    action_type, action_params ?? {},
    typeof vote_window_ticks === 'number' ? vote_window_ticks : undefined,
  );
  if (!r.ok) return res.status(400).json({ error: r.reason });
  res.json({ ok: true, id: r.id });
});

router.post('/governance/vote', authInGameAgentLegacy, rateLimit, (req: Request, res: Response) => {
  const agentId = (req as any).agentId;
  const { decree_id, choice } = req.body ?? {};
  const c = choice === 1 || choice === true || choice === 'yes' ? 1 : 0;
  const r = castVote(agentId, Number(decree_id), c as 0 | 1);
  if (!r.ok) return res.status(400).json({ error: r.reason });
  res.json({ ok: true, weight: r.weight, choice: c });
});

router.get('/governance/active', (_req: Request, res: Response) => {
  const decrees = getActiveDecrees().map((d) => ({
    ...d,
    action_params: safeJson(d.action_params),
    votes: getVotes(d.id),
  }));
  res.json({ decrees });
});

router.get('/governance/recent', (_req: Request, res: Response) => {
  const decrees = getRecentDecrees().map((d) => ({
    ...d,
    action_params: safeJson(d.action_params),
  }));
  res.json({ decrees });
});

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

// X (Twitter) verification removed in Phase 0 per spec §12 — agents are
// identified by wallet address only. The x_handle / x_verified columns
// stay in place for a release cycle so the migration is reversible; they
// can be dropped once we confirm nothing depends on them.

export default router;
