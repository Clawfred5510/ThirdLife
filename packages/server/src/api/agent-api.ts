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
  transferCredits,
  tradeSellResources,
  workProduce,
  buyLand,
} from '../db';
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
  addEvent('auth_failure', null, { ip, path, reason, key_hint: apiKeyHint, ua });
}

// ── Rate limiter: token bucket keyed by API key (auth'd) or IP (anon) ───
// 60 req/min sustained with burst of 30. In-process, single-node only — if
// we ever horizontally scale, swap for Redis-backed bucket.
const RATE_CAPACITY = 30;
const RATE_REFILL_PER_MS = 60 / 60_000; // 60 tokens per 60s
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
  // Return events filtered to this agent
  const id = (req as any).agentId;
  const all = getEvents(200);
  const mine = all.filter(e => e.player_id === id);
  res.json({ events: mine });
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

router.get('/events', (_req: Request, res: Response) => {
  res.json({ events: getEvents(100) });
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
      { name: 'trade', method: 'POST', path: '/api/v1/actions/trade', cost: 'Free', description: 'Sell resources at market prices.' },
      { name: 'chat', method: 'POST', path: '/api/v1/actions/chat', cost: 'Free', description: 'Send a message to another agent.' },
    ],
    info_endpoints: [
      { method: 'GET', path: '/api/v1/world', auth: false },
      { method: 'GET', path: '/api/v1/agents', auth: false },
      { method: 'GET', path: '/api/v1/agents/me', auth: true },
      { method: 'GET', path: '/api/v1/agents/me/events', auth: true },
      { method: 'GET', path: '/api/v1/market/prices', auth: false },
      { method: 'GET', path: '/api/v1/agents/:id/stats', auth: false },
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
  addEvent('explore', agentId, { parcel: target.id });
  res.json({ ok: true, parcel: { id: target.id, grid_x: target.grid_x, grid_y: target.grid_y }, cost: EXPLORE_COST });
});

router.post('/actions/buy-land', authAgent, rateLimit, (req: Request, res: Response) => {
  const agentId = (req as any).agentId;
  const { parcel_id, x, y } = req.body ?? {};
  const pid = parcel_id ?? (typeof x === 'number' && typeof y === 'number' ? x * 50 + y : undefined);
  if (pid === undefined) return res.status(400).json({ error: 'parcel_id (or x,y) required' });

  const result = buyLand(agentId, pid);
  if (!result.ok) {
    const status = result.reason === 'insufficient_balance' ? 400 : 400;
    return res.status(status).json({ error: result.reason, cost: LAND_COST });
  }
  addEvent('buy_land', agentId, { parcel: pid, cost: LAND_COST });
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
  addEvent('build', agentId, { parcel: pid, building: building_type, cost: spec.cost });
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
  addEvent('work', agentId, { produced, creditsEarned });
  res.json({ ok: true, produced, creditsEarned, resources, balance: result.credits });
});

router.post('/actions/trade', authAgent, rateLimit, (req: Request, res: Response) => {
  const agentId = (req as any).agentId;
  const { resource, quantity, target_agent_id, amount } = req.body ?? {};

  // Transfer $AMETA to another agent (atomic, validates target exists)
  if (target_agent_id !== undefined || amount !== undefined) {
    if (typeof target_agent_id !== 'string' || !target_agent_id) {
      return res.status(400).json({ error: 'target_agent_id (string) required for transfer' });
    }
    if (typeof amount !== 'number' || amount <= 0 || !Number.isFinite(amount)) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    const result = transferCredits(agentId, target_agent_id, amount);
    if (!result.ok) {
      const status = result.reason === 'target_not_found' ? 404 : 400;
      return res.status(status).json({ error: result.reason });
    }
    addEvent('transfer', agentId, { to: target_agent_id, amount });
    return res.json({ ok: true, transferred: amount, to: target_agent_id });
  }

  // Sell resources (atomic debit+credit)
  if (!resource || !quantity) return res.status(400).json({ error: 'resource and quantity required (or target_agent_id + amount for transfer)' });
  if (!RESOURCE_TYPES.includes(resource as ResourceType)) return res.status(400).json({ error: 'Invalid resource', valid: RESOURCE_TYPES });
  if (typeof quantity !== 'number' || quantity <= 0) return res.status(400).json({ error: 'quantity must be positive' });

  const price = BASE_MARKET_PRICES[resource as ResourceType];
  const earnings = Math.floor(price * quantity);
  const result = tradeSellResources(agentId, resource as ResourceType, quantity, earnings);
  if (!result.ok) return res.status(400).json({ error: result.reason });
  addEvent('trade', agentId, { resource, quantity, earned: earnings });
  res.json({ ok: true, sold: resource, quantity, earned: earnings, resources: result.resources, balance: result.credits });
});

router.post('/actions/chat', authAgent, rateLimit, (req: Request, res: Response) => {
  const agentId = (req as any).agentId;
  const { target_agent_id, message } = req.body ?? {};
  if (!target_agent_id || !message) return res.status(400).json({ error: 'target_agent_id and message required' });
  addEvent('chat', agentId, { to: target_agent_id, message });
  res.json({ ok: true });
});

export default router;
