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
  tradeSellResources,
  workProduce,
  buyLand,
} from '../db';
import { economy, WORLD_TREASURY_ID } from '../economy';
import { placeOrder, cancelOrder, getBook, getOwnerOrders } from '../market/orderBook';
import { getLeaderboard, getNetWorth, isValidSort } from '../leaderboard';
import { getWorldTick, getLastTickGdp, recordGdp } from '../world';
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
  TRADING_FEE_BPS,
  BPS_DENOMINATOR,
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
  const agentId = (req as any).agentId as string | undefined;
  const ip = (req.ip || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
  const key = agentId ? `agent:${agentId}` : `ip:${ip}`;
  if (!consumeToken(key)) {
    res.setHeader('Retry-After', '60');
    res.status(429).json({ error: 'Rate limit exceeded. Max 60 req/min per agent.' });
    return;
  }
  next();
}

// ── Auth middleware for agent actions ────────────────────────────────────

function authAgent(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    logAuthFailure(req, 'missing_header', null);
    res.status(401).json({ error: 'Authorization header required: Bearer <api_key>' });
    return;
  }
  const apiKey = auth.slice(7);
  const agent = getAgentByApiKey(apiKey);
  if (!agent) {
    // Log only a short prefix so full keys don't end up in logs
    const hint = apiKey.length >= 10 ? apiKey.slice(0, 10) + '…' : '(short)';
    logAuthFailure(req, 'invalid_key', hint);
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }
  (req as any).agentId = agent.id;
  (req as any).agentName = agent.name;
  next();
}

// ── Registration (no auth required) ─────────────────────────────────────

router.post('/agents/register', (req: Request, res: Response) => {
  const { name, personality, strategy_preset } = req.body ?? {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name (string) required' });
  if (!personality || !AGENT_PERSONALITIES.includes(personality as AgentPersonality)) {
    return res.status(400).json({ error: `personality required, one of: ${AGENT_PERSONALITIES.join(', ')}` });
  }
  if (!strategy_preset || !AGENT_STRATEGIES.includes(strategy_preset as AgentStrategy)) {
    return res.status(400).json({ error: `strategy_preset required, one of: ${AGENT_STRATEGIES.join(', ')}` });
  }

  const id = generateId();
  const apiKey = generateApiKey();

  try {
    registerAgent(id, name, personality, strategy_preset, apiKey);
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Agent name already taken' });
    return res.status(500).json({ error: 'Registration failed' });
  }

  addEvent('agent_registered', id, { name, personality, strategy_preset });

  res.json({
    ok: true,
    agent: { id, name, balance: STARTING_BALANCE, personality, strategy_preset },
    api_key: apiKey,
    note: 'Save this API key — it is only shown once.',
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
  const players = getAllPlayers();
  res.json({
    agents: players.map(p => ({
      id: p.id,
      name: p.name,
      balance: p.credits,
    })),
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

router.get('/agents/:id/stats', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const resources = getPlayerResources(id);
  const parcels = getPlayerParcels(id);
  res.json({
    id,
    resources,
    parcels: parcels.length,
    buildings: parcels.filter(p => (p as any).building_type).length,
    owned_parcels: parcels.map(p => ({
      id: p.id, grid_x: p.grid_x, grid_y: p.grid_y,
      building_type: (p as any).building_type,
      business_name: p.business_name,
    })),
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
  addEvent('build', agentId, { parcel: pid, building: building_type, cost: spec.cost }, 'major');
  res.json({ ok: true, building: building_type, cost: spec.cost });
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

router.post('/actions/trade', authAgent, rateLimit, async (req: Request, res: Response) => {
  const agentId = (req as any).agentId;
  const { resource, quantity, target_agent_id, amount } = req.body ?? {};

  // Transfer $AMETA to another agent. Routed through IEconomy so the
  // 1% transfer fee is taken automatically and the on-chain swap path
  // works without changing call sites later.
  if (target_agent_id !== undefined || amount !== undefined) {
    if (typeof target_agent_id !== 'string' || !target_agent_id) {
      return res.status(400).json({ error: 'target_agent_id (string) required for transfer' });
    }
    if (typeof amount !== 'number' || amount <= 0 || !Number.isFinite(amount)) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    try {
      const result = await economy().transfer(agentId, target_agent_id, amount, 'agent_transfer');
      if (!result.ok) {
        const status = result.reason === 'target_not_found' ? 404 : 400;
        return res.status(status).json({ error: result.reason });
      }
      return res.json({ ok: true, transferred: amount, to: target_agent_id, fee: result.fee });
    } catch (e) {
      console.error('[api] transfer failed:', e);
      return res.status(500).json({ error: 'internal_error' });
    }
  }

  // Sell resources at base market price. Applies the same trading fee as
  // the order book so agents can't dodge fees by hitting the legacy path.
  if (!resource || !quantity) return res.status(400).json({ error: 'resource and quantity required (or target_agent_id + amount for transfer)' });
  if (!RESOURCE_TYPES.includes(resource as ResourceType)) return res.status(400).json({ error: 'Invalid resource', valid: RESOURCE_TYPES });
  if (typeof quantity !== 'number' || quantity <= 0) return res.status(400).json({ error: 'quantity must be positive' });

  const price = BASE_MARKET_PRICES[resource as ResourceType];
  const gross = Math.floor(price * quantity);
  const fee = Math.floor((gross * TRADING_FEE_BPS) / BPS_DENOMINATOR);
  const earnings = gross - fee;
  const result = tradeSellResources(agentId, resource as ResourceType, quantity, earnings);
  if (!result.ok) return res.status(400).json({ error: result.reason });
  if (fee > 0) {
    await economy().credit(WORLD_TREASURY_ID, fee, 'trading_fee');
  }
  recordGdp(earnings);
  addEvent('trade', agentId, { resource, quantity, gross, fee, earned: earnings }, 'normal');
  res.json({ ok: true, sold: resource, quantity, earned: earnings, fee, resources: result.resources, balance: result.credits });
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

router.post('/market/order', authAgent, rateLimit, async (req: Request, res: Response) => {
  const agentId = (req as any).agentId;
  const { resource, side, price, quantity } = req.body ?? {};
  if (!Number.isInteger(price) || !Number.isInteger(quantity)) {
    return res.status(400).json({ error: 'price and quantity must be integers' });
  }
  try {
    const r = await placeOrder(agentId, resource, side, price, quantity);
    if (!r.ok) return res.status(400).json({ error: r.reason });
    res.json({ ok: true, order: r.result?.order, trades: r.result?.trades ?? [] });
  } catch (e) {
    console.error('[api] market/order failed:', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.delete('/market/order/:id', authAgent, rateLimit, async (req: Request, res: Response) => {
  const agentId = (req as any).agentId;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const r = await cancelOrder(agentId, id);
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

router.get('/market/orders', authAgent, (req: Request, res: Response) => {
  const agentId = (req as any).agentId;
  res.json({ orders: getOwnerOrders(agentId) });
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

export default router;
