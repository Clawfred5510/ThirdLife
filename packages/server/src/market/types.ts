import type { ResourceType } from '@gamestu/shared';

export type Side = 'buy' | 'sell';
export type OrderStatus = 'open' | 'filled' | 'cancelled';

export interface MarketOrder {
  id: number;
  resource: ResourceType;
  side: Side;
  owner_id: string;
  price: number;       // unit price in $AMETA, integer
  quantity: number;    // total qty requested
  filled: number;      // qty already matched
  status: OrderStatus;
  created_at: number;  // ms epoch
}

export interface MarketTrade {
  id: number;
  resource: ResourceType;
  buyer_id: string;
  seller_id: string;
  price: number;
  quantity: number;
  fee: number;
  executed_at: number;
}

export interface BookSnapshot {
  resource: ResourceType;
  bids: { price: number; quantity: number }[]; // descending price
  asks: { price: number; quantity: number }[]; // ascending price
  recentTrades: MarketTrade[];
}

export interface MatchResult {
  trades: MarketTrade[];
  /** Resulting state of the inbound order — may be partial-filled. */
  order: MarketOrder;
}
