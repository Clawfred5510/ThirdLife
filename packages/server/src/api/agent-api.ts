import { Router, Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import {
  getAllParcels,
  getAllPlayers,
  getPlayerResources,
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
  getAuthSessionPlayerId,
  workProduce,
  buyLand,
} from '../db';
import { economy } from '../economy';
import { placeOrder, cancelOrder, getBook, getOwnerOrders } from '../market/orderBook';
import { getLeaderboard, getNetWorth, isValidSort } from '../leaderboard';
import { getWorldTick, getLastTickGdp, recordGdp } from '../world';
import { getAllAgents } from '../db';
import { computeLevel, computeJob } from '../agents-meta';
import {
  generateUnitsForParcel,
  getPropertiesForParcel,
  getPropertiesForOwner,
  getAllForSale,
  listProperty,
  unlistProperty,
  buyProperty,
  buildingHasUnits,
} from '../properties';
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
  EXPLORE_COST,
  LAND_COST,
  STARTING_BALANCE,
  AGENT_PERSONALITIES,
  AGENT_STRATEGIES,
  AgentPersonality,
  AgentStrategy,
  CURRENCY_NAME,
} from '@gamestu/shared';

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

// ── Registration (wallet-gated) ─────────────────────────────────────────
//
// Every agent is owned by exactly one wallet. The caller must present a
// wallet session token; the new agent's owner_wallet is set to that wallet.
// Cap: 10 agents per wallet. New agents start at 0 balance — owners fund
// them via POST /agents/:id/allocate.

const MAX_AGENTS_PER_WALLET = 10;

router.post('/agents/register', authWallet, (req: Request, res: Response) => {
  const { name, personality, strategy_preset } = req.body ?? {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name (string) required' });
  if (!personality || !AGENT_PERSONALITIES.includes(personality as AgentPersonality)) {
    return res.status(400).json({ error: `personality required, one of: ${AGENT_PERSONALITIES.join(', ')}` });
  }
  if (!strategy_preset || !AGENT_STRATEGIES.includes(strategy_preset as AgentStrategy)) {
    return res.status(400).json({ error: `strategy_preset required, one of: ${AGENT_STRATEGIES.join(', ')}` });
  }

  const wallet = (req as AuthedRequest).walletId!;
  if (countAgentsByWallet(wallet) >= MAX_AGENTS_PER_WALLET) {
    return res.status(409).json({ error: 'wallet_at_agent_cap', limit: MAX_AGENTS_PER_WALLET });
  }

  const id = `${wallet}:agent:${crypto.randomBytes(8).toString('hex')}`;
  const apiKey = generateApiKey();

  try {
    registerAgent(id, name, personality, strategy_preset, apiKey, wallet);
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Agent name already taken' });
    return res.status(500).json({ error: 'Registration failed' });
  }

  addEvent('agent_registered', id, { name, personality, strategy_preset, owner_wallet: wallet });

  res.json({
    ok: true,
    agent: { id, name, balance: 0, personality, strategy_preset, owner_wallet: wallet },
    api_key: apiKey,
    note: 'Save this API key — it is only shown once. Fund the agent via POST /agents/' + id + '/allocate.',
  });
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
    return {
      id: a.id,
      name: a.name,
      personality: a.personality,
      strategy: a.strategy,
      balance: getPlayerCredits(a.id),
      resources: getPlayerResources(a.id),
      land_count: parcels.length,
      building_count: parcels.filter((p) => (p as any).building_type).length,
      autopilot_enabled: a.autopilot_enabled === 1,
      last_autopilot_tick: a.last_autopilot_tick,
      created_at: a.created_at,
    };
  });
  res.json({ wallet, agents: out, limit: MAX_AGENTS_PER_WALLET });
});

router.post('/agents/:id/allocate', authWallet, rateLimit, async (req: Request, res: Response) => {
  const wallet = (req as AuthedRequest).walletId!;
  const agentId = String(req.params.id);
  const { amount } = req.body ?? {};
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive integer' });
  }
  try {
    const r = await economy().allocate(wallet, agentId, amount, 'fund');
    if (!r.ok) {
      const status = r.reason === 'agent_not_found' ? 404 : r.reason === 'not_owner' ? 403 : 400;
      return res.status(status).json({ error: r.reason });
    }
    res.json({ ok: true, agent_balance: getPlayerCredits(agentId), wallet_balance: getPlayerCredits(wallet) });
  } catch (e) {
    console.error('[api] allocate failed:', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/agents/:id/reclaim', authWallet, rateLimit, async (req: Request, res: Response) => {
  const wallet = (req as AuthedRequest).walletId!;
  const agentId = String(req.params.id);
  const { amount } = req.body ?? {};
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive integer' });
  }
  try {
    const r = await economy().allocate(wallet, agentId, amount, 'reclaim');
    if (!r.ok) {
      const status = r.reason === 'agent_not_found' ? 404 : r.reason === 'not_owner' ? 403 : 400;
      return res.status(status).json({ error: r.reason });
    }
    res.json({ ok: true, agent_balance: getPlayerCredits(agentId), wallet_balance: getPlayerCredits(wallet) });
  } catch (e) {
    console.error('[api] reclaim failed:', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/agents/:id/stats', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const resources = getPlayerResources(id);
  const parcels = getPlayerParcels(id);
  const nw = getNetWorth(id);
  const recentEvents = getEvents(50, { playerId: id });
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
      { name: 'explore', method: 'POST', path: '/api/v1/actions/explore', cost: `${EXPLORE_COST} ${CURRENCY_NAME}`, description: 'Move to a random unclaimed parcel.' },
      { name: 'buy_land', method: 'POST', path: '/api/v1/actions/buy-land', cost: `${LAND_COST} ${CURRENCY_NAME}`, description: 'Buy an unclaimed parcel.' },
      { name: 'build', method: 'POST', path: '/api/v1/actions/build', cost: `50,000 - 2,000,000 ${CURRENCY_NAME}`, description: 'Build on owned parcel.' },
      { name: 'work', method: 'POST', path: '/api/v1/actions/work', cost: 'Free', description: 'Produce resources from buildings.' },
      { name: 'trade', method: 'POST', path: '/api/v1/actions/trade', cost: 'Free', description: 'Sell resources at market prices, or transfer AMETA to another agent.' },
      { name: 'chat', method: 'POST', path: '/api/v1/actions/chat', cost: 'Free', description: 'Send a message to another agent.' },
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
    limits: { starting_balance: STARTING_BALANCE, land_cost: LAND_COST, explore_cost: EXPLORE_COST },
  });
});

// ── Action endpoints (require auth + rate limit) ───────────────────────

router.post('/actions/explore', authAgent, rateLimit, (req: Request, res: Response) => {
  const agentId = (req as any).agentId;
  const credits = getPlayerCredits(agentId);
  if (credits < EXPLORE_COST) return res.status(400).json({ error: 'Insufficient balance', cost: EXPLORE_COST });

  const parcels = getAllParcels().filter(p => !p.owner_id);
  if (parcels.length === 0) return res.status(400).json({ error: 'No unclaimed parcels' });

  const target = parcels[Math.floor(Math.random() * parcels.length)];
  updatePlayerCredits(agentId, credits - EXPLORE_COST);
  addEvent('explore', agentId, { parcel: target.id }, 'minor');
  res.json({ ok: true, parcel: { id: target.id, grid_x: target.grid_x, grid_y: target.grid_y }, cost: EXPLORE_COST });
});

router.post('/actions/buy-land', authAgent, rateLimit, (req: Request, res: Response) => {
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

router.post('/actions/build', authAgent, rateLimit, (req: Request, res: Response) => {
  const agentId = (req as any).agentId;
  const { parcel_id, x, y, building_type } = req.body ?? {};
  const pid = parcel_id ?? (typeof x === 'number' && typeof y === 'number' ? x * 50 + y : undefined);
  if (pid === undefined || !building_type) return res.status(400).json({ error: 'parcel_id (or x,y) and building_type required' });

  const spec = BUILDINGS[building_type as BuildingType];
  if (!spec) return res.status(400).json({ error: 'Unknown building type', valid: Object.keys(BUILDINGS) });

  const credits = getPlayerCredits(agentId);
  if (credits < spec.cost) return res.status(400).json({ error: 'Insufficient balance', cost: spec.cost });

  const parcels = getPlayerParcels(agentId);
  if (!parcels.find(p => p.id === pid)) return res.status(400).json({ error: 'You do not own this parcel' });

  updatePlayerCredits(agentId, credits - spec.cost);
  setBuildingType(pid, building_type);
  updateBusiness(pid, agentId, { type: building_type, name: spec.label });
  // Phase C: apartments/offices generate sub-units on build.
  const unitsCreated = buildingHasUnits(building_type)
    ? generateUnitsForParcel(pid, building_type, agentId)
    : 0;
  addEvent('build', agentId, { parcel: pid, building: building_type, cost: spec.cost, units_created: unitsCreated }, 'major');
  res.json({ ok: true, building: building_type, cost: spec.cost, units_created: unitsCreated });
});

router.post('/actions/work', authAgent, rateLimit, (req: Request, res: Response) => {
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

router.post('/actions/chat', authAgent, rateLimit, (req: Request, res: Response) => {
  const agentId = (req as any).agentId;
  const { target_agent_id, message } = req.body ?? {};
  if (!target_agent_id || !message) return res.status(400).json({ error: 'target_agent_id and message required' });
  addEvent('chat', agentId, { to: target_agent_id, message }, 'minor');
  res.json({ ok: true });
});

// ──────────────────────────────────────────────────────────────────────
// Market (order book) — Phase A.1
// ──────────────────────────────────────────────────────────────────────

router.post('/market/order', authPlayer, rateLimit, async (req: Request, res: Response) => {
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

router.delete('/market/order/:id', authPlayer, rateLimit, async (req: Request, res: Response) => {
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
  const r = req.params.resource;
  if (!RESOURCE_TYPES.includes(r as ResourceType)) {
    return res.status(400).json({ error: 'invalid resource' });
  }
  res.json(getBook(r as ResourceType));
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

// ──────────────────────────────────────────────────────────────────────
// Properties (sub-units inside multi-floor buildings) — Phase C
// ──────────────────────────────────────────────────────────────────────

router.get('/properties', (req: Request, res: Response) => {
  const parcelIdStr = req.query.parcel_id;
  const forSale = req.query.for_sale === 'true';
  const ownerId = typeof req.query.owner_id === 'string' ? req.query.owner_id : null;

  if (typeof parcelIdStr === 'string') {
    const pid = parseInt(parcelIdStr, 10);
    if (!Number.isFinite(pid)) return res.status(400).json({ error: 'invalid parcel_id' });
    return res.json({ properties: getPropertiesForParcel(pid, forSale) });
  }
  if (ownerId) return res.json({ properties: getPropertiesForOwner(ownerId) });
  return res.json({ properties: getAllForSale() });
});

router.post('/actions/list-property', authAgent, rateLimit, (req: Request, res: Response) => {
  const agentId = (req as any).agentId;
  const { property_id, price } = req.body ?? {};
  const r = listProperty(agentId, Number(property_id), Math.floor(Number(price)));
  if (!r.ok) return res.status(400).json({ error: r.reason });
  res.json({ ok: true });
});

router.post('/actions/unlist-property', authAgent, rateLimit, (req: Request, res: Response) => {
  const agentId = (req as any).agentId;
  const { property_id } = req.body ?? {};
  const r = unlistProperty(agentId, Number(property_id));
  if (!r.ok) return res.status(400).json({ error: r.reason });
  res.json({ ok: true });
});

router.post('/actions/buy-property', authAgent, rateLimit, async (req: Request, res: Response) => {
  const agentId = (req as any).agentId;
  const { property_id } = req.body ?? {};
  try {
    const r = await buyProperty(agentId, Number(property_id));
    if (!r.ok) return res.status(400).json({ error: r.reason });
    res.json({ ok: true, paid: r.price });
  } catch (e) {
    console.error('[api] buy-property failed:', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

// ──────────────────────────────────────────────────────────────────────
// Governance / Decrees — Phase E.3
// ──────────────────────────────────────────────────────────────────────

router.post('/governance/propose', authAgent, rateLimit, (req: Request, res: Response) => {
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

router.post('/governance/vote', authAgent, rateLimit, (req: Request, res: Response) => {
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

// ──────────────────────────────────────────────────────────────────────
// Phase E.2 — X (Twitter) verification stub.
// Real flow needs the X API v2 OAuth + tweet-content lookup. Until the
// keys land, expose a /me/x-verify endpoint that records a handle but
// flags x_verified = 0 (unverified) so the upgrade is a small change
// to call the X API instead of trusting the input.
// ──────────────────────────────────────────────────────────────────────

import { getRawDb as _rawDb } from '../db';

router.post('/agents/me/x-verify', authAgent, (req: Request, res: Response) => {
  const agentId = (req as any).agentId;
  const handle = String((req.body ?? {}).handle ?? '').trim().replace(/^@/, '');
  if (!handle || handle.length > 30 || !/^[A-Za-z0-9_]+$/.test(handle)) {
    return res.status(400).json({ error: 'invalid_handle' });
  }
  // Stub — record handle as pending; x_verified stays 0 until the real
  // X API flow lands.
  _rawDb().prepare('UPDATE agents SET x_handle = ?, x_verified = 0 WHERE id = ?').run(handle, agentId);
  res.json({ ok: true, handle, verified: false, note: 'X API integration is pending — the recorded handle is unverified for now.' });
});

router.get('/agents/me/x-status', authAgent, (req: Request, res: Response) => {
  const agentId = (req as any).agentId;
  const row = _rawDb().prepare('SELECT x_handle, x_verified FROM agents WHERE id = ?').get(agentId) as { x_handle: string | null; x_verified: number } | undefined;
  res.json({ handle: row?.x_handle ?? null, verified: row?.x_verified === 1 });
});

export default router;
