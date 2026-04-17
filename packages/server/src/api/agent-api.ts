import { Router, Request, Response } from 'express';
import {
  getOrCreatePlayer,
  getAllParcels,
  getAllPlayers,
  getPlayerResources,
  updatePlayerResources,
  getPlayerCredits,
  updatePlayerCredits,
  claimParcel,
  getPlayerParcels,
  setBuildingType,
  updateBusiness,
  addEvent,
  getEvents,
} from '../db';
import {
  BUILDINGS,
  BuildingType,
  BASE_MARKET_PRICES,
  ResourceType,
  RESOURCE_TYPES,
  EXPLORE_COST,
  LAND_COST,
} from '@gamestu/shared';

const router = Router();

// ── Public info endpoints ──────────────────────────────────────────────

router.get('/world', (_req: Request, res: Response) => {
  const parcels = getAllParcels();
  const players = getAllPlayers();
  res.json({
    parcels: parcels.length,
    claimed: parcels.filter(p => !!p.owner_id).length,
    players: players.length,
    parcels_data: parcels.filter(p => !!p.owner_id).slice(0, 200),
  });
});

router.get('/agents', (_req: Request, res: Response) => {
  const players = getAllPlayers();
  res.json({
    agents: players.map(p => ({
      id: p.id,
      name: p.name,
      credits: p.credits,
    })),
  });
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
      id: p.id,
      grid_x: p.grid_x,
      grid_y: p.grid_y,
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
  res.json({
    name: 'ThirdLife',
    version: '1.0',
    description: 'Multiplayer life simulation — claim land, build, produce, trade.',
    actions: [
      { name: 'explore', method: 'POST', path: '/api/v1/actions/explore', cost: `${EXPLORE_COST} credits` },
      { name: 'buy_land', method: 'POST', path: '/api/v1/actions/buy-land', cost: `${LAND_COST} credits` },
      { name: 'build', method: 'POST', path: '/api/v1/actions/build', cost: 'varies by type' },
      { name: 'work', method: 'POST', path: '/api/v1/actions/work', cost: 'free' },
      { name: 'trade', method: 'POST', path: '/api/v1/actions/trade', cost: 'free' },
    ],
    buildings: BUILDINGS,
    resources: RESOURCE_TYPES,
    market_prices: BASE_MARKET_PRICES,
  });
});

// ── Action endpoints ───────────────────────────────────────────────────

router.post('/actions/explore', (req: Request, res: Response) => {
  const { agent_id } = req.body ?? {};
  if (!agent_id) return res.status(400).json({ error: 'agent_id required' });

  const credits = getPlayerCredits(agent_id);
  if (credits < EXPLORE_COST) return res.status(400).json({ error: 'Insufficient credits' });

  const parcels = getAllParcels().filter(p => !p.owner_id);
  if (parcels.length === 0) return res.status(400).json({ error: 'No unclaimed parcels' });

  const target = parcels[Math.floor(Math.random() * parcels.length)];
  updatePlayerCredits(agent_id, credits - EXPLORE_COST);
  addEvent('explore', agent_id, { parcel: target.id });
  res.json({ ok: true, parcel: { id: target.id, grid_x: target.grid_x, grid_y: target.grid_y }, cost: EXPLORE_COST });
});

router.post('/actions/buy-land', (req: Request, res: Response) => {
  const { agent_id, parcel_id } = req.body ?? {};
  if (!agent_id || parcel_id === undefined) return res.status(400).json({ error: 'agent_id and parcel_id required' });

  const credits = getPlayerCredits(agent_id);
  if (credits < LAND_COST) return res.status(400).json({ error: 'Insufficient credits', cost: LAND_COST });

  const success = claimParcel(parcel_id, agent_id);
  if (!success) return res.status(400).json({ error: 'Parcel unavailable or already claimed' });

  updatePlayerCredits(agent_id, credits - LAND_COST);
  addEvent('buy_land', agent_id, { parcel: parcel_id, cost: LAND_COST });
  res.json({ ok: true, parcel_id, cost: LAND_COST });
});

router.post('/actions/build', (req: Request, res: Response) => {
  const { agent_id, parcel_id, building_type } = req.body ?? {};
  if (!agent_id || parcel_id === undefined || !building_type) return res.status(400).json({ error: 'agent_id, parcel_id, building_type required' });

  const spec = BUILDINGS[building_type as BuildingType];
  if (!spec) return res.status(400).json({ error: 'Unknown building type', valid: Object.keys(BUILDINGS) });

  const credits = getPlayerCredits(agent_id);
  if (credits < spec.cost) return res.status(400).json({ error: 'Insufficient credits', cost: spec.cost });

  const parcels = getPlayerParcels(agent_id);
  if (!parcels.find(p => p.id === parcel_id)) return res.status(400).json({ error: 'You do not own this parcel' });

  updatePlayerCredits(agent_id, credits - spec.cost);
  setBuildingType(parcel_id, building_type);
  updateBusiness(parcel_id, agent_id, { type: building_type, name: spec.label });
  addEvent('build', agent_id, { parcel: parcel_id, building: building_type, cost: spec.cost });
  res.json({ ok: true, building: building_type, cost: spec.cost });
});

router.post('/actions/work', (req: Request, res: Response) => {
  const { agent_id } = req.body ?? {};
  if (!agent_id) return res.status(400).json({ error: 'agent_id required' });

  const parcels = getPlayerParcels(agent_id);
  const resources = getPlayerResources(agent_id);
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

  if (creditsEarned > 0) updatePlayerCredits(agent_id, getPlayerCredits(agent_id) + creditsEarned);
  updatePlayerResources(agent_id, resources);
  addEvent('work', agent_id, { produced, creditsEarned });
  res.json({ ok: true, produced, creditsEarned, resources });
});

router.post('/actions/trade', (req: Request, res: Response) => {
  const { agent_id, resource, quantity } = req.body ?? {};
  if (!agent_id || !resource || !quantity) return res.status(400).json({ error: 'agent_id, resource, quantity required' });
  if (!RESOURCE_TYPES.includes(resource as ResourceType)) return res.status(400).json({ error: 'Invalid resource', valid: RESOURCE_TYPES });
  if (typeof quantity !== 'number' || quantity <= 0) return res.status(400).json({ error: 'quantity must be positive number' });

  const resources = getPlayerResources(agent_id);
  const key = resource as keyof typeof resources;
  if (resources[key] < quantity) return res.status(400).json({ error: 'Insufficient resource' });

  const price = BASE_MARKET_PRICES[resource as ResourceType];
  const earnings = Math.floor(price * quantity);
  resources[key] -= quantity;
  updatePlayerResources(agent_id, resources);
  updatePlayerCredits(agent_id, getPlayerCredits(agent_id) + earnings);

  addEvent('trade', agent_id, { resource, quantity, earned: earnings });
  res.json({ ok: true, sold: resource, quantity, earned: earnings, resources });
});

export default router;
