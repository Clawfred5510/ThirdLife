import type { Database, Statement } from 'better-sqlite3';
import { TRADING_FEE_BPS, BPS_DENOMINATOR, RESOURCE_TYPES } from '@gamestu/shared';
import type { ResourceType } from '@gamestu/shared';
import {
  getPlayerCredits,
  updatePlayerCredits,
  getPlayerResources,
  updatePlayerResources,
  addEvent,
  getRawDb,
} from '../db';
import { economy, WORLD_TREASURY_ID } from '../economy';
import { recordGdp } from '../world';
import { getRuntimeTradingFeeBps } from '../governance';
import { MarketOrder, MarketTrade, BookSnapshot, MatchResult, Side } from './types';

function effectiveTradingFeeBps(): number {
  const override = getRuntimeTradingFeeBps();
  return override ?? TRADING_FEE_BPS;
}

interface MarketOrderRow {
  id: number;
  resource: ResourceType;
  side: Side;
  owner_id: string;
  price: number;
  quantity: number;
  filled: number;
  status: 'open' | 'filled' | 'cancelled';
  created_at: number;
}

interface MarketTradeRow {
  id: number;
  resource: ResourceType;
  buyer_id: string;
  seller_id: string;
  price: number;
  quantity: number;
  fee: number;
  executed_at: number;
}

// Lazy-init module-scoped prepared statements. better-sqlite3 caches
// these internally too, but lifting them out of hot loops avoids the
// per-call lookup. Initialised on first call to ensure the DB is ready.
let stmts: {
  insertOrder: Statement;
  selectOrder: Statement;
  selectCandidates: (priceCondition: '<= ?' | '>= ?', sortDir: 'ASC' | 'DESC') => Statement;
  insertTrade: Statement;
  updateOrderFill: Statement;
  cancelOrder: Statement;
  bookBids: Statement;
  bookAsks: Statement;
  recentTrades: Statement;
  ownerOpenOrders: Statement;
  bestBid: Statement;
} | null = null;

function getStmts() {
  if (stmts) return stmts;
  const db = getRawDb();
  const candidateCache = new Map<string, Statement>();
  stmts = {
    insertOrder: db.prepare(`
      INSERT INTO market_orders (resource, side, owner_id, price, quantity, filled, status, created_at)
      VALUES (?, ?, ?, ?, ?, 0, 'open', ?)
    `),
    selectOrder: db.prepare('SELECT * FROM market_orders WHERE id = ?'),
    selectCandidates: (priceCondition, sortDir) => {
      const key = `${priceCondition}|${sortDir}`;
      let s = candidateCache.get(key);
      if (!s) {
        s = db.prepare(`
          SELECT * FROM market_orders
          WHERE resource = ? AND side = ? AND status = 'open' AND price ${priceCondition}
            AND owner_id != ?
          ORDER BY price ${sortDir}, created_at ASC
        `);
        candidateCache.set(key, s);
      }
      return s;
    },
    insertTrade: db.prepare(`
      INSERT INTO market_trades (resource, buyer_id, seller_id, price, quantity, fee, executed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    updateOrderFill: db.prepare('UPDATE market_orders SET filled = ?, status = ? WHERE id = ?'),
    cancelOrder: db.prepare(`UPDATE market_orders SET status = 'cancelled' WHERE id = ?`),
    bookBids: db.prepare(`
      SELECT price, SUM(quantity - filled) AS quantity FROM market_orders
      WHERE resource = ? AND side = 'buy' AND status = 'open'
      GROUP BY price
      ORDER BY price DESC LIMIT 20
    `),
    bookAsks: db.prepare(`
      SELECT price, SUM(quantity - filled) AS quantity FROM market_orders
      WHERE resource = ? AND side = 'sell' AND status = 'open'
      GROUP BY price
      ORDER BY price ASC LIMIT 20
    `),
    recentTrades: db.prepare(
      `SELECT * FROM market_trades WHERE resource = ? ORDER BY executed_at DESC LIMIT 50`,
    ),
    ownerOpenOrders: db.prepare(
      `SELECT * FROM market_orders WHERE owner_id = ? AND status = 'open' ORDER BY created_at DESC`,
    ),
    bestBid: db.prepare(
      `SELECT MAX(price) AS p FROM market_orders WHERE resource = ? AND side = 'buy' AND status = 'open'`,
    ),
  };
  return stmts;
}

function rowToOrder(row: MarketOrderRow): MarketOrder {
  return {
    id: row.id,
    resource: row.resource,
    side: row.side,
    owner_id: row.owner_id,
    price: row.price,
    quantity: row.quantity,
    filled: row.filled,
    status: row.status,
    created_at: row.created_at,
  };
}

/**
 * Place a limit order. Validates the placer can afford it (sell: has the
 * resources; buy: has the credits), escrows what's needed, then runs the
 * match engine. Returns trades produced and the final state of the order.
 *
 * Match policy: price-time priority FIFO. Within a price level, oldest
 * order matches first. Partial fills are supported.
 */
export async function placeOrder(
  ownerId: string,
  resource: ResourceType,
  side: Side,
  price: number,
  quantity: number,
): Promise<{ ok: boolean; reason?: string; result?: MatchResult }> {
  if (!RESOURCE_TYPES.includes(resource)) return { ok: false, reason: 'invalid_resource' };
  if (side !== 'buy' && side !== 'sell') return { ok: false, reason: 'invalid_side' };
  if (!Number.isInteger(price) || price <= 0) return { ok: false, reason: 'invalid_price' };
  if (!Number.isInteger(quantity) || quantity <= 0) return { ok: false, reason: 'invalid_quantity' };

  if (side === 'sell') {
    const res = getPlayerResources(ownerId);
    if (res[resource] < quantity) return { ok: false, reason: 'insufficient_resource' };
    const updated = { ...res, [resource]: res[resource] - quantity };
    updatePlayerResources(ownerId, updated);
  } else {
    const debitResult = await economy().debit(ownerId, price * quantity, 'market_order_buy_escrow');
    if (!debitResult.ok) return { ok: false, reason: debitResult.reason };
  }

  const s = getStmts();
  const now = Date.now();
  const ins = s.insertOrder.run(resource, side, ownerId, price, quantity, now);
  const orderId = ins.lastInsertRowid as number;
  const order: MarketOrder = {
    id: orderId,
    resource,
    side,
    owner_id: ownerId,
    price,
    quantity,
    filled: 0,
    status: 'open',
    created_at: now,
  };

  const matchResult = matchOrder(order);
  return { ok: true, result: matchResult };
}

/**
 * Match engine for a single inbound order. Walks the opposing book in
 * price-time order until the inbound is fully filled or no more crossing
 * orders exist. The whole pass runs inside a single SQLite transaction
 * so a crash mid-loop can't half-settle a fill.
 */
function matchOrder(inbound: MarketOrder): MatchResult {
  const s = getStmts();
  const db = getRawDb();
  const trades: MarketTrade[] = [];

  // Build the WHERE/ORDER directionality for the candidate scan.
  const isBuy = inbound.side === 'buy';
  const opposingSide: Side = isBuy ? 'sell' : 'buy';
  const sortDir = isBuy ? 'ASC' : 'DESC';
  const priceCondition = isBuy ? '<= ?' : '>= ?';

  const tx = db.transaction(() => {
    let remaining = inbound.quantity - inbound.filled;
    const candidates = s.selectCandidates(priceCondition, sortDir).all(
      inbound.resource,
      opposingSide,
      inbound.price,
      inbound.owner_id,
    ) as MarketOrderRow[];

    let totalFee = 0;

    for (const candRow of candidates) {
      if (remaining <= 0) break;
      const cand = rowToOrder(candRow);
      const candAvail = cand.quantity - cand.filled;
      if (candAvail <= 0) continue;
      const matchQty = Math.min(remaining, candAvail);
      // Resting (older) order's price wins.
      const tradePrice = cand.price;

      const buyer = isBuy ? inbound.owner_id : cand.owner_id;
      const seller = isBuy ? cand.owner_id : inbound.owner_id;

      const grossPayout = tradePrice * matchQty;
      const fee = Math.floor((grossPayout * effectiveTradingFeeBps()) / BPS_DENOMINATOR);
      const sellerEarn = grossPayout - fee;

      // Buyer receives the resource.
      const buyerRes = getPlayerResources(buyer);
      const buyerResNew = { ...buyerRes, [inbound.resource]: buyerRes[inbound.resource] + matchQty };
      updatePlayerResources(buyer, buyerResNew);

      // Seller receives net payout. Buyer's escrow already held the funds.
      updatePlayerCredits(seller, getPlayerCredits(seller) + sellerEarn);
      recordGdp(sellerEarn);
      totalFee += fee;

      // Refund the buyer the price difference if they paid more than the
      // trade clears at (their escrow was at inbound.price for buy side).
      if (isBuy && inbound.price > tradePrice) {
        const refund = (inbound.price - tradePrice) * matchQty;
        updatePlayerCredits(inbound.owner_id, getPlayerCredits(inbound.owner_id) + refund);
      }

      const tradeNow = Date.now();
      const tradeIns = s.insertTrade.run(
        inbound.resource, buyer, seller, tradePrice, matchQty, fee, tradeNow,
      );
      const tradeId = tradeIns.lastInsertRowid as number;
      const trade: MarketTrade = {
        id: tradeId,
        resource: inbound.resource,
        buyer_id: buyer,
        seller_id: seller,
        price: tradePrice,
        quantity: matchQty,
        fee,
        executed_at: tradeNow,
      };
      trades.push(trade);

      addEvent('trade', seller, {
        resource: inbound.resource,
        quantity: matchQty,
        price: tradePrice,
        fee,
        earned: sellerEarn,
        buyer_id: buyer,
      }, 'normal');

      const newCandFilled = cand.filled + matchQty;
      const candStatus: 'filled' | 'open' = newCandFilled >= cand.quantity ? 'filled' : 'open';
      s.updateOrderFill.run(newCandFilled, candStatus, cand.id);

      inbound.filled += matchQty;
      remaining -= matchQty;
    }

    // Single treasury credit for all fees in this match pass.
    if (totalFee > 0) {
      updatePlayerCredits(WORLD_TREASURY_ID, getPlayerCredits(WORLD_TREASURY_ID) + totalFee);
    }

    const inboundStatus: 'filled' | 'open' = inbound.filled >= inbound.quantity ? 'filled' : 'open';
    s.updateOrderFill.run(inbound.filled, inboundStatus, inbound.id);
    inbound.status = inboundStatus;
  });

  tx();

  return { trades, order: inbound };
}

/** Cancel an open order. Refunds escrowed resource (sell) or credits (buy). */
export async function cancelOrder(
  ownerId: string,
  orderId: number,
): Promise<{ ok: boolean; reason?: string }> {
  const s = getStmts();
  const row = s.selectOrder.get(orderId) as MarketOrderRow | undefined;
  if (!row) return { ok: false, reason: 'not_found' };
  const order = rowToOrder(row);
  if (order.owner_id !== ownerId) return { ok: false, reason: 'not_owner' };
  if (order.status !== 'open') return { ok: false, reason: 'not_cancellable' };

  const remaining = order.quantity - order.filled;
  if (remaining > 0) {
    if (order.side === 'sell') {
      const res = getPlayerResources(ownerId);
      const updated = { ...res, [order.resource]: res[order.resource] + remaining };
      updatePlayerResources(ownerId, updated);
    } else {
      await economy().credit(ownerId, order.price * remaining, 'market_order_cancel_refund');
    }
  }
  s.cancelOrder.run(orderId);
  return { ok: true };
}

/** Snapshot of bids/asks (aggregated by price) + last 50 trades for a resource. */
export function getBook(resource: ResourceType): BookSnapshot {
  const s = getStmts();
  const bids = s.bookBids.all(resource) as Array<{ price: number; quantity: number }>;
  const asks = s.bookAsks.all(resource) as Array<{ price: number; quantity: number }>;
  const recentTrades = (s.recentTrades.all(resource) as MarketTradeRow[]).map((t) => ({
    id: t.id,
    resource: t.resource,
    buyer_id: t.buyer_id,
    seller_id: t.seller_id,
    price: t.price,
    quantity: t.quantity,
    fee: t.fee,
    executed_at: t.executed_at,
  }));
  return { resource, bids, asks, recentTrades };
}

/** All open orders for a given owner (for "my orders" UI / cancel). */
export function getOwnerOrders(ownerId: string): MarketOrder[] {
  const s = getStmts();
  return (s.ownerOpenOrders.all(ownerId) as MarketOrderRow[]).map(rowToOrder);
}

/** Best-bid price — used by the legacy tradeSellResources path to pick a
 *  market price when no explicit limit is given. Returns 0 if the book
 *  is empty.
 */
export function getBestBid(resource: ResourceType): number {
  const s = getStmts();
  const row = s.bestBid.get(resource) as { p: number | null } | undefined;
  return row?.p ?? 0;
}

/** Test-only: reset the cached prepared statements. Needed because the
 *  legacy in-memory path tries to use the same module across tests.
 */
export function resetMarketStatementsForTesting() {
  stmts = null;
}
