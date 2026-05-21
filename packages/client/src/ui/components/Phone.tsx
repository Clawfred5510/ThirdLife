import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost, apiDelete, hasAuthToken, API_BASE } from '../../network/api';
import {
  hasInjectedWallet,
  getStoredPlayerId,
  getStoredAuthToken,
  connectWallet,
  logoutWallet,
} from '../../network/wallet';
import {
  RESOURCE_TYPES, ResourceType,
  GRID_COLS, GRID_ROWS, LANDMARKS,
  AGENT_PERSONALITIES, AGENT_STRATEGIES,
  AgentPersonality, AgentStrategy,
  JOBS, JobId,
  LUXURY_ITEMS, LuxuryItemKind,
  BUILDINGS, BuildingType, BuildingCategory,
} from '@gamestu/shared';

type AppId =
  | 'leaderboard' | 'market' | 'events' | 'world2d' | 'governance'
  | 'agents' | 'closet' | 'wallet' | 'inventory' | 'rank';
type ActiveApp = AppId | null;

interface AppDef {
  id: AppId;
  label: string;
  icon: string;
  color: string;
}

// Palette pulled from gamedesigns/ — terra cotta, ochre, forest green,
// teal, sandstone, slate. Warm, painterly, no neon.
const APPS: AppDef[] = [
  { id: 'wallet',      label: 'Wallet',      icon: '👛', color: '#3F2A6E' }, // deep violet
  { id: 'inventory',   label: 'Inventory',   icon: '🎒', color: '#7A4F2E' }, // wood — luxury items
  { id: 'rank',        label: 'Rank',        icon: '🎖️', color: '#B5563A' }, // terra cotta
  { id: 'agents',      label: 'My Agents',   icon: '🤖', color: '#5C6F8A' }, // slate-blue
  { id: 'closet',      label: 'Closet',      icon: '👕', color: '#A8556B' }, // dusty rose
  { id: 'market',      label: 'Market',      icon: '📈', color: '#3F7A3D' }, // forest
  { id: 'leaderboard', label: 'Leaderboard', icon: '🏆', color: '#D89438' }, // ochre
  // 'properties' (Phase C sub-units) hidden in UI Overhaul 2026-05-20.
  // The legacy module still exists server-side; nothing new is created.
  { id: 'world2d',     label: 'Map',         icon: '🗺️', color: '#2A5560' }, // teal
  { id: 'governance',  label: 'Decrees',     icon: '🗳️', color: '#7A4F2E' }, // wood
  // UI Overhaul: rename Events → Notifications. The events feed now
  // also surfaces offline-accrual recap entries and craft notifications.
  { id: 'events',      label: 'Notifications', icon: '🔔', color: '#D8C4A0' }, // sandstone
];

// ── Shared types ──────────────────────────────────────────────────────

interface LeaderboardEntry {
  id: string; name: string; balance: number; reputation: number;
  parcels: number; buildings: number; net_worth: number;
}
type LeaderboardSort = 'net_worth' | 'balance' | 'land' | 'properties' | 'reputation';

interface BookLevel { price: number; quantity: number; }
interface RecentTrade { id: number; price: number; quantity: number; fee: number; executed_at: number; }
interface BookSnapshot {
  resource: ResourceType;
  bids: BookLevel[];
  asks: BookLevel[];
  recentTrades: RecentTrade[];
}

interface EventRow {
  id: number; type: string; player_id: string | null;
  data: string; severity: string; created_at: string;
}
type Severity = 'all' | 'epic' | 'major' | 'normal' | 'minor';

interface PropertyRow {
  id: number; parcel_id: number; unit_type: 'studio' | 'office' | 'penthouse';
  floor: number; unit_index: number;
  owner_id: string | null; list_price: number | null; income_per_tick: number;
}
type PropertyFilter = 'for_sale' | 'all';

const SORT_LABEL: Record<LeaderboardSort, string> = {
  net_worth: 'Net Worth', balance: 'Balance', land: 'Land',
  properties: 'Properties', reputation: 'Rep',
};
const SEVERITY_LABEL: Record<Severity, string> = {
  all: 'All', epic: 'Epic', major: 'Major', normal: 'Normal', minor: 'Minor',
};
const SEVERITY_COLOR: Record<string, string> = {
  epic: '#D89438', major: '#3F7A3D', normal: '#F5E6D0', minor: '#A89378',
};
const RES_ICON: Record<ResourceType, string> = {
  food: '🌾', materials: '⛏️', energy: '⚡', luxury: '💎',
};

function formatAmeta(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function summarizeEvent(e: EventRow): string {
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(e.data); } catch { /* malformed */ }
  switch (e.type) {
    case 'trade':       return `traded ${data.quantity} ${data.resource} @ ${data.price ?? '—'} (fee ${data.fee ?? 0})`;
    case 'work':        return `worked: +${data.creditsEarned ?? 0} $AMETA`;
    case 'buy_land': {
      const via = data.agent_name ? ` (via 🛰️ ${data.agent_name})` : '';
      return `bought parcel #${data.parcel}${via}`;
    }
    case 'claim_and_build':
    case 'build':       return `built ${data.building} on parcel #${data.parcel}`;
    case 'transfer':    return `sent ${data.amount} to ${data.to} (fee ${data.fee ?? 0})`;
    case 'agent_registered': {
      const via = data.agent_name ? ` (via 🛰️ ${data.agent_name})` : '';
      return `registered agent: ${data.name}${via}`;
    }
    case 'agent_role_changed': return `agent role: ${data.from} → ${data.to}`;
    case 'agent_revived': return `revived agent (paid ${data.food_paid ?? 100} food)`;
    case 'burn_luxury': return `used ${data.quantity}× ${data.item_kind} for +${data.rank_points_gained} luxury`;
    case 'rank_up':     return `🎉 RANK UP: ${data.from ?? 'unranked'} → ${data.to}`;
    case 'craft_item':  return `agent crafted ${data.quantity}× ${data.item_kind} at parcel #${data.parcel}`;
    case 'external_trade': {
      const name = data.agent_name ?? 'external agent';
      const side = data.side ?? '?';
      const qty = data.quantity ?? 0;
      const filled = Number(data.filled ?? 0);
      return `🛰️ ${name} ${side} ${qty}× ${data.resource} @ ${data.price}` + (filled > 0 ? ` (filled ${filled})` : '');
    }
    case 'external_agent_registered': {
      const budget = Number(data.budget_ameta ?? 0);
      return `🛰️ external agent ${data.name} connected (budget ${budget.toLocaleString()} $AMETA)`;
    }
    case 'building_unpowered': {
      const n = data.unpowered_count ?? 0;
      const short = data.energy_short_by ?? 0;
      const sample = Array.isArray(data.sample_parcels) ? (data.sample_parcels as number[]) : [];
      const where = sample.length ? ` (e.g. #${sample.join(', #')})` : '';
      return `⚡ ${n} building${n === 1 ? '' : 's'} idle — short ${short} energy${where}`;
    }
    case 'offline_accrual': {
      const t = data.missed_ticks ?? 0;
      const lux = data.luxury ?? 0;
      const wages = data.wages ?? 0;
      return `welcome back — ${t} ticks while away: +${lux} luxury, +${wages} $AMETA wages`;
    }
    default:            return e.type;
  }
}

// ── Phone root ────────────────────────────────────────────────────────
//
// A single iPhone-style device sits at the bottom-right of the screen.
// The phone icon button toggles the device open/closed. When open the
// home screen shows an app grid; tapping an app pushes it onto the
// screen. A home indicator (or the back arrow in the app header) goes
// back to the home grid.

export const Phone: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [activeApp, setActiveApp] = useState<ActiveApp>(null);
  const [now, setNow] = useState(() => new Date());

  // Status-bar clock — pure cosmetic, ticks once per minute.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Phase 6: world-side shortcut — clicking a built Market building (or
  // any future plot-side trigger) dispatches `tl-open-app` with the
  // target app id, which the Phone opens directly.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ app?: AppId }>).detail;
      if (!detail?.app) return;
      const known = APPS.find((a) => a.id === detail.app);
      if (!known) return;
      setOpen(true);
      setActiveApp(detail.app);
    };
    window.addEventListener('tl-open-app', handler);
    return () => window.removeEventListener('tl-open-app', handler);
  }, []);

  const close = () => { setOpen(false); setActiveApp(null); };
  const goHome = () => setActiveApp(null);

  // The Closet app is special: it doesn't have an in-phone view. Tapping the
  // icon dispatches the open-character-creator event and closes the phone so
  // the user gets the full-screen editor without overlapping UI.
  const launchApp = (id: AppId) => {
    if (id === 'closet') {
      window.dispatchEvent(new CustomEvent('open-character-creator'));
      close();
      return;
    }
    setActiveApp(id);
  };

  const activeAppDef = activeApp ? APPS.find((a) => a.id === activeApp) ?? null : null;

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ ...S.fab, ...(open ? S.fabActive : {}) }}
        aria-label="Toggle phone"
        aria-pressed={open}
      >
        <span style={S.fabIcon}>📱</span>
      </button>

      {open && (
        <div style={S.phoneFrame} role="dialog" aria-label="Phone">
          {/* Bezel */}
          <div style={S.phoneScreen}>
            {/* Status bar */}
            <div style={S.statusBar}>
              <span style={S.statusTime}>
                {now.getHours().toString().padStart(2, '0')}:{now.getMinutes().toString().padStart(2, '0')}
              </span>
              <span style={S.notch} />
              <span style={S.statusRight}>● ●● ▮</span>
            </div>

            {/* Screen content */}
            <div style={S.screenContent}>
              {!activeApp ? (
                <HomeScreen onLaunch={launchApp} />
              ) : (
                <AppView app={activeAppDef!} onBack={goHome} />
              )}
            </div>

            {/* Home indicator */}
            <button
              onClick={activeApp ? goHome : close}
              style={S.homeIndicator}
              aria-label={activeApp ? 'Back to home screen' : 'Close phone'}
            >
              <span style={S.homeBar} />
            </button>
          </div>
        </div>
      )}
    </>
  );
};

// ── Phone home screen — app grid ──────────────────────────────────────

const HomeScreen: React.FC<{ onLaunch: (id: AppId) => void }> = ({ onLaunch }) => {
  return (
    <div style={S.homeWallpaper}>
      <div style={S.homeTitle}>ThirdLife</div>
      <div style={S.appGrid}>
        {APPS.map((app) => (
          <button
            key={app.id}
            onClick={() => onLaunch(app.id)}
            style={S.appTileBtn}
            aria-label={`Open ${app.label}`}
          >
            <div style={{ ...S.appIcon, background: app.color }}>
              <span style={S.appEmoji}>{app.icon}</span>
            </div>
            <span style={S.appLabel}>{app.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

// ── App container — header + body ─────────────────────────────────────

const AppView: React.FC<{ app: AppDef; onBack: () => void }> = ({ app, onBack }) => {
  return (
    <div style={S.appView}>
      <div style={S.appHeader}>
        <button onClick={onBack} style={S.backBtn} aria-label="Back to home screen">
          ←
        </button>
        <span style={S.appHeaderTitle}>
          <span style={S.appHeaderIcon}>{app.icon}</span> {app.label}
        </span>
        <span style={{ width: 28 }} />
      </div>
      <div style={S.appBody}>
        {app.id === 'leaderboard' && <LeaderboardBody />}
        {app.id === 'market' && <MarketBody />}
        {app.id === 'world2d' && <World2DBody />}
        {app.id === 'governance' && <GovernanceBody />}
        {app.id === 'events' && <EventBody />}
        {app.id === 'agents' && <AgentsBody />}
        {app.id === 'wallet' && <WalletBody />}
        {app.id === 'inventory' && <InventoryBody />}
        {app.id === 'rank' && <RankBody />}
      </div>
    </div>
  );
};

// ── Panels ────────────────────────────────────────────────────────────

const LeaderboardBody: React.FC = () => {
  const [sort, setSort] = useState<LeaderboardSort>('net_worth');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiGet<{ entries: LeaderboardEntry[] }>(`/leaderboard?sort=${sort}&limit=10`)
        .then((r) => { if (!cancelled) setEntries(r.entries); })
        .catch(() => {});
    load();
    const i = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(i); };
  }, [sort]);

  return (
    <>
      <div style={S.tabRow}>
        {(Object.keys(SORT_LABEL) as LeaderboardSort[]).map((s) => (
          <button key={s} onClick={() => setSort(s)} style={{ ...S.tab, ...(s === sort ? S.tabActive : {}) }}>
            {SORT_LABEL[s]}
          </button>
        ))}
      </div>
      <div style={S.list}>
        {entries.length === 0 ? (
          <div style={S.empty}>No agents yet</div>
        ) : (
          entries.map((e, i) => {
            const value =
              sort === 'net_worth' ? e.net_worth :
              sort === 'balance' ? e.balance :
              sort === 'land' ? e.parcels :
              sort === 'properties' ? e.buildings :
              e.reputation;
            const isCurrency = sort === 'net_worth' || sort === 'balance';
            return (
              <div key={e.id} style={S.row}>
                <span style={S.rank}>#{i + 1}</span>
                <span style={S.name}>{e.name}</span>
                <span style={S.valueG}>{isCurrency ? `${formatAmeta(value)} $AMETA` : value}</span>
              </div>
            );
          })
        )}
      </div>
    </>
  );
};

interface OpenOrder {
  id: number;
  resource: ResourceType;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  filled: number;
}

const MarketBody: React.FC = () => {
  const [resource, setResource] = useState<ResourceType>('food');
  const [book, setBook] = useState<BookSnapshot | null>(null);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState<string>('');
  const [qty, setQty] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const signedIn = hasAuthToken();

  const loadBook = () =>
    apiGet<BookSnapshot>(`/market/book/${resource}`).then(setBook).catch(() => {});
  const loadOrders = () => {
    if (!signedIn) return;
    apiGet<{ orders: OpenOrder[] }>('/market/orders', { authed: true })
      .then((r) => setOrders(r.orders))
      .catch(() => {});
  };

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      apiGet<BookSnapshot>(`/market/book/${resource}`)
        .then((r) => { if (!cancelled) setBook(r); })
        .catch(() => {});
      if (signedIn && !cancelled) loadOrders();
    };
    tick();
    const i = setInterval(tick, 4000);
    return () => { cancelled = true; clearInterval(i); };
  }, [resource, signedIn]);

  const submit = async () => {
    setMsg(null);
    const p = parseInt(price, 10);
    const q = parseInt(qty, 10);
    if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(q) || q <= 0) {
      setMsg('Enter a positive integer price and quantity.');
      return;
    }
    setBusy(true);
    try {
      const r = await apiPost<{ ok: boolean; trades: unknown[] }>(
        '/market/order',
        { resource, side, price: p, quantity: q },
        { authed: true },
      );
      const filled = (r.trades ?? []).length;
      setMsg(filled > 0 ? `Order placed — ${filled} fill(s).` : 'Order placed — resting in book.');
      setPrice(''); setQty('');
      loadBook();
      loadOrders();
    } catch (e) {
      setMsg(`Failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: number) => {
    try {
      await apiDelete(`/market/order/${id}`, { authed: true });
      loadOrders();
      loadBook();
    } catch (e) {
      setMsg(`Cancel failed: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <div style={S.tabRow}>
        {RESOURCE_TYPES.map((r) => (
          <button key={r} onClick={() => setResource(r)} style={{ ...S.tab, ...(r === resource ? S.tabActive : {}) }}>
            <span>{RES_ICON[r]}</span> {r}
          </button>
        ))}
      </div>
      <div style={S.cols}>
        <div>
          <div style={S.colHeader}>Bids</div>
          {book?.bids.length ? book.bids.map((b) => (
            <div key={`b${b.price}`} style={{ ...S.level, color: '#22c55e' }}>
              <span>{b.price}</span><span>{b.quantity}</span>
            </div>
          )) : <div style={S.empty}>No bids</div>}
        </div>
        <div>
          <div style={S.colHeader}>Asks</div>
          {book?.asks.length ? book.asks.map((a) => (
            <div key={`a${a.price}`} style={{ ...S.level, color: '#ef4444' }}>
              <span>{a.price}</span><span>{a.quantity}</span>
            </div>
          )) : <div style={S.empty}>No asks</div>}
        </div>
      </div>

      <div style={S.colHeader}>Place order</div>
      {!signedIn ? (
        <div style={S.empty}>Connect a wallet to place orders.</div>
      ) : (
        <div style={S.formGrid}>
          <div style={S.sideToggle}>
            <button
              onClick={() => setSide('buy')}
              style={{ ...S.sideBtn, ...(side === 'buy' ? S.sideBtnBuy : {}) }}
            >
              Buy
            </button>
            <button
              onClick={() => setSide('sell')}
              style={{ ...S.sideBtn, ...(side === 'sell' ? S.sideBtnSell : {}) }}
            >
              Sell
            </button>
          </div>
          <input
            type="number" min={1} step={1} value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Price ($AMETA)"
            style={S.input}
            aria-label="Limit price"
          />
          <input
            type="number" min={1} step={1} value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="Quantity"
            style={S.input}
            aria-label="Order quantity"
          />
          <button onClick={submit} disabled={busy} style={S.submit}>
            {busy ? '...' : `${side === 'buy' ? 'Buy' : 'Sell'} ${resource}`}
          </button>
          {msg && <div style={S.formMsg}>{msg}</div>}
        </div>
      )}

      {signedIn && orders.length > 0 && (
        <>
          <div style={S.colHeader}>My open orders</div>
          <div style={S.trades}>
            {orders.map((o) => (
              <div key={o.id} style={S.openOrderRow}>
                <span style={{ color: o.side === 'buy' ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                  {o.side === 'buy' ? 'BUY' : 'SELL'}
                </span>
                <span style={{ color: '#e4e4ef' }}>{o.resource}</span>
                <span style={{ color: '#8b8b9a' }}>
                  {o.quantity - o.filled}/{o.quantity} @ {o.price}
                </span>
                <button onClick={() => cancel(o.id)} style={S.cancelBtn} aria-label={`Cancel order ${o.id}`}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={S.colHeader}>Recent trades</div>
      <div style={S.trades}>
        {book?.recentTrades.length ? book.recentTrades.slice(0, 8).map((t) => (
          <div key={t.id} style={S.trade}>
            <span style={{ color: '#e4e4ef' }}>{t.quantity}</span>
            <span style={{ color: '#8b8b9a' }}> @ </span>
            <span style={{ color: '#22c55e' }}>{t.price}</span>
            <span style={{ color: '#8b8b9a', marginLeft: 6, fontSize: 10 }}>(fee {t.fee})</span>
          </div>
        )) : <div style={S.empty}>No trades yet</div>}
      </div>
    </>
  );
};

// ── My Agents tab — wallet's owned agents, allocate/reclaim, create new ─

interface AgentRow {
  id: string;
  name: string;
  job: JobId | null;
  job_label: string | null;
  job_icon: string | null;
  workplace_parcel_id: number | null;
  personality: string;
  strategy: string;
  // Phase 2/3 role enum.
  role: 'work' | 'produce' | 'craft';
  is_external: boolean;
  dormant: boolean;
  starvation_ticks: number;
  balance: number;
  resources: { food: number; materials: number; energy: number; luxury: number };
  land_count: number;
  building_count: number;
  autopilot_enabled: boolean;
  created_at: string;
}

type AgentRole = AgentRow['role'];
const AGENT_ROLE_LIST: AgentRole[] = ['work', 'produce', 'craft'];
const ROLE_LABEL: Record<AgentRole, string> = {
  work: 'Work',
  produce: 'Produce',
  craft: 'Craft',
};
const ROLE_HINT: Record<AgentRole, string> = {
  work: 'Stands at the workplace. Will earn a flat wage (Phase 4 in progress).',
  produce: 'Adds to the workplace’s base output every tick.',
  craft: 'Consumes input resource to mint a named luxury item every tick.',
};

interface AgentsMine {
  wallet: string;
  agents: AgentRow[];
  /** Legacy single-cap (in-game). New clients read in_game_limit + external_limit. */
  limit: number;
  in_game_limit?: number;
  external_limit?: number;
  rank?: string;
}

interface WorldParcel {
  id: number;
  grid_x: number;
  grid_y: number;
  owner_id: string;
  business_type: string;
  business_name: string;
}

interface WorldResp {
  parcels: number;
  claimed: number;
  agents: number;
  tick: number;
  gdp: number;
  parcels_data: WorldParcel[];
}

const AgentsBody: React.FC = () => {
  const [data, setData] = useState<AgentsMine | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const signedIn = hasAuthToken();

  const refresh = () => {
    if (!signedIn) return;
    apiGet<AgentsMine>('/agents/mine', { authed: true })
      .then((r) => { setData(r); setErr(null); })
      .catch((e) => setErr((e as Error).message));
  };

  useEffect(() => {
    if (!signedIn) return;
    refresh();
    const i = setInterval(refresh, 8000);
    return () => clearInterval(i);
  }, [signedIn]);

  if (!signedIn) {
    return (
      <div style={S.emptyPad}>
        Connect a wallet to spawn and manage AI agents.
      </div>
    );
  }

  // Split into external (pinned, green) + in-game (default, brown).
  // Both groups share the same AgentCard component — the green theme is
  // applied conditionally on agent.is_external.
  const externalAgents = data?.agents.filter((a) => a.is_external) ?? [];
  const inGameAgents = data?.agents.filter((a) => !a.is_external) ?? [];
  const inGameLimit = data?.in_game_limit ?? data?.limit ?? 0;
  const externalLimit = data?.external_limit ?? 0;
  const atInGameCap = !!data && inGameAgents.length >= inGameLimit;

  return (
    <>
      <div style={S.agentHeader}>
        <span style={S.agentCount}>
          {data ? (
            <>
              <strong style={{ color: '#F5E6D0' }}>{inGameAgents.length}</strong>/{inGameLimit} in-game
              <span style={{ color: '#7A6850', margin: '0 4px' }}>·</span>
              <strong style={{ color: '#9FD89A' }}>{externalAgents.length}</strong>/{externalLimit} external
            </>
          ) : '…'}
        </span>
        <button
          onClick={() => setShowCreate(true)}
          disabled={atInGameCap}
          style={S.createBtn}
          title={atInGameCap ? 'In-game agent cap reached — rank up to add more' : 'Spawn a new in-game agent'}
        >
          + New in-game
        </button>
      </div>
      {err && <div style={S.errMsg}>{err}</div>}
      {data && data.agents.length === 0 && (
        <div style={S.emptyPad}>
          You have no agents yet. Spawn an in-game agent below, or wire up an
          external AI via the API.
        </div>
      )}
      <div style={S.agentList}>
        {/* External agents pin to the top in a green-themed group so they
            stand out visually from the brownish-yellow in-game cards. */}
        {externalAgents.length > 0 && (
          <>
            <div style={S.agentSectionLabel}>
              <span style={{ color: '#9FD89A' }}>▍</span> External agents
              <span style={S.agentSectionMeta}>
                {externalAgents.length}/{externalLimit}
              </span>
            </div>
            {externalAgents.map((a) => (
              <AgentCard key={a.id} agent={a} onChange={refresh} />
            ))}
          </>
        )}
        {/* Connect-external CTA — registration is documentation-driven
            (the player or their external AI signs the wallet challenge
            against /agents/register-external), so we point at the spec
            rather than embed a modal. */}
        <ExternalAgentCTA
          atCap={!!data && externalAgents.length >= externalLimit}
          limit={externalLimit}
        />
        {inGameAgents.length > 0 && (
          <>
            <div style={{ ...S.agentSectionLabel, marginTop: 8 }}>
              <span style={{ color: '#D89438' }}>▍</span> In-game agents
              <span style={S.agentSectionMeta}>
                {inGameAgents.length}/{inGameLimit}
              </span>
            </div>
            {inGameAgents.map((a) => (
              <AgentCard key={a.id} agent={a} onChange={refresh} />
            ))}
          </>
        )}
      </div>
      {showCreate && (
        <CreateAgentModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            // Agent is fully autonomous from this point — the API key is
            // stashed on the agent's record (retrievable later via the
            // "API key" disclosure on the agent card). The owner has
            // nothing to copy.
            setShowCreate(false);
            refresh();
          }}
        />
      )}
    </>
  );
};

/**
 * External-agent connect call-to-action.
 *
 * External agents are wallet-signed REST clients (OpenClaw, Hermes,
 * custom scripts) — they aren't created from the in-game phone. This
 * card explains the flow in one sentence and links to the live API
 * spec on the running server. Greens out when the player has hit
 * their external-agent cap.
 */
const ExternalAgentCTA: React.FC<{ atCap: boolean; limit: number }> = ({ atCap, limit }) => {
  const docsUrl = `${API_BASE}/api/v1/spec`;
  return (
    <div style={S.externalCTA}>
      <div style={S.externalCTAHead}>
        <span style={S.externalCTAIcon} aria-hidden>⚡</span>
        <span style={S.externalCTATitle}>Connect an external AI agent</span>
      </div>
      <div style={S.externalCTABody}>
        External agents trade on the marketplace on your behalf via REST.
        Registration is wallet-signed — you (or your AI) follow the docs at{' '}
        <code style={S.externalCTACode}>/api/v1/agents/register-external</code>.
        {atCap ? (
          <>
            {' '}<strong style={{ color: '#fca5a5' }}>Cap reached</strong> — rank up
            to connect more (current cap: {limit}).
          </>
        ) : (
          <> Up to {limit} at your current rank.</>
        )}
      </div>
      <a
        href={docsUrl}
        target="_blank"
        rel="noreferrer noopener"
        style={S.externalCTABtn}
      >
        View API docs →
      </a>
    </div>
  );
};

const AgentCard: React.FC<{ agent: AgentRow; onChange: () => void }> = ({ agent, onChange }) => {
  const [mode, setMode] = useState<'idle' | 'reassign' | 'confirm_delete'>('idle');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  const exportApiKey = async () => {
    setExportBusy(true);
    setErr(null);
    try {
      const r = await apiGet<{ ok: boolean; api_key: string }>(
        `/agents/${agent.id}/api-key`, { authed: true },
      );
      setApiKey(r.api_key);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setExportBusy(false);
    }
  };

  const toggleAutopilot = async () => {
    setBusy(true);
    setErr(null);
    try {
      await apiPost(
        `/agents/${agent.id}/autopilot`,
        { enabled: !agent.autopilot_enabled },
        { authed: true },
      );
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setErr(null);
    setBusy(true);
    try {
      await apiDelete(`/agents/${agent.id}`, { authed: true });
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const jobIcon = agent.job_icon ?? '🤖';
  const jobLabel = agent.job_label ?? agent.personality;
  const reqBuilding = agent.job ? JOBS[agent.job]?.requires_building : undefined;

  return (
    <div style={agent.is_external ? { ...S.agentCard, ...S.agentCardExternal } : S.agentCard}>
      <div style={S.agentCardHead}>
        <span style={S.agentName}>
          <span style={{ marginRight: 4 }}>{agent.is_external ? '🛰️' : jobIcon}</span>{agent.name}
          {agent.is_external && (
            <span style={S.externalBadge} aria-label="External agent">EXT</span>
          )}
        </span>
        <span style={S.agentBal}>{formatAmeta(agent.balance)} $AMETA</span>
      </div>
      <div style={S.agentMeta}>
        <span>{jobLabel}</span>
        <span>·</span>
        <span>
          {agent.workplace_parcel_id
            ? `parcel #${agent.workplace_parcel_id}`
            : reqBuilding
              ? 'no workplace'
              : 'roams'}
        </span>
        <span>·</span>
        <span>{agent.autopilot_enabled ? 'autopilot on' : 'autopilot off'}</span>
        {agent.dormant && (<>
          <span>·</span>
          <span style={{ color: '#B5563A' }}>dormant ({agent.starvation_ticks}t)</span>
        </>)}
      </div>
      {/* Dormant agents: role picker greyed, big red Revive CTA. */}
      {agent.dormant && !agent.is_external && (
        <ReviveButton agent={agent} onRevived={onChange} />
      )}
      {/* Role picker. External agents are market-only and have no role.
       *  Dormant agents see a greyed-out preview only. */}
      {!agent.is_external && (
        <div style={{ opacity: agent.dormant ? 0.4 : 1, pointerEvents: agent.dormant ? 'none' : 'auto' }}>
          <RoleSwitcher agent={agent} onChange={onChange} setBusy={setBusy} busy={busy} />
        </div>
      )}
      {mode === 'idle' && (
        <div style={S.agentActions}>
          {/* Fund + Reclaim removed in UI Overhaul (2026-05-20). Wages
              now flow straight to the wallet — no per-agent funding
              needed. The endpoints stay on the server for back-compat
              but are hidden from the UI. */}
          {!agent.is_external && (
            <button onClick={() => setMode('reassign')} style={S.reclaimBtn}>
              Reassign
            </button>
          )}
          <button onClick={() => setMode('confirm_delete')} style={S.dangerBtn} aria-label={`Remove ${agent.name}`}>
            Remove
          </button>
        </div>
      )}
      {mode === 'confirm_delete' && (
        <div style={S.confirmDeleteRow}>
          <span style={S.confirmDeleteText}>
            Remove <strong>{agent.name}</strong>? Their parcels, balance, and resources return to your wallet.
          </span>
          <div style={S.confirmDeleteActions}>
            <button
              onClick={() => { setMode('idle'); setErr(null); }}
              style={S.cancelTextBtn}
              disabled={busy}
            >
              cancel
            </button>
            <button onClick={remove} disabled={busy} style={S.dangerBtn}>
              {busy ? '…' : 'Remove'}
            </button>
          </div>
          {err && <div style={S.formMsg}>{err}</div>}
        </div>
      )}
      {/* Fund/Reclaim mode removed in UI Overhaul (2026-05-20). */}
      {mode === 'reassign' && (
        <ReassignModal
          agent={agent}
          onClose={() => setMode('idle')}
          onDone={() => { setMode('idle'); onChange(); }}
        />
      )}
      {mode === 'idle' && (
        <div style={S.advancedRow}>
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            style={S.advancedToggle}
          >
            {showAdvanced ? '▾' : '▸'} Advanced
          </button>
          {showAdvanced && (
            <div style={S.advancedBody}>
              <div style={S.advancedRowItem}>
                <span style={S.advancedLabel}>
                  Driver: <strong>{agent.autopilot_enabled ? 'AUTO (server)' : 'AGENT (external)'}</strong>
                </span>
                <button onClick={toggleAutopilot} disabled={busy} style={S.advancedSmallBtn}>
                  {busy ? '…' : agent.autopilot_enabled ? 'Hand to external' : 'Take back'}
                </button>
              </div>
              <div style={S.advancedRowItem}>
                <span style={S.advancedLabel}>External runtime key</span>
                {apiKey ? (
                  <button
                    onClick={() => { navigator.clipboard?.writeText(apiKey).catch(() => {}); }}
                    style={S.advancedSmallBtn}
                  >
                    Copy
                  </button>
                ) : (
                  <button onClick={exportApiKey} disabled={exportBusy} style={S.advancedSmallBtn}>
                    {exportBusy ? '…' : 'Reveal'}
                  </button>
                )}
              </div>
              {apiKey && (
                <code style={S.apiKeyCode}>{apiKey}</code>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ReviveButton: React.FC<{ agent: AgentRow; onRevived: () => void }> = ({ agent, onRevived }) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const revive = async () => {
    setBusy(true);
    setErr(null);
    try {
      await apiPost(`/agents/${agent.id}/revive`, {}, { authed: true });
      onRevived();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={S.reviveWrap}>
      <button onClick={revive} disabled={busy} style={S.reviveBtn} aria-label={`Revive ${agent.name} for 100 food`}>
        {busy ? '…' : 'Revive for 100 🌾'}
      </button>
      {err && <div style={S.formMsg}>{err}</div>}
    </div>
  );
};

const RoleSwitcher: React.FC<{
  agent: AgentRow;
  onChange: () => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}> = ({ agent, onChange, busy, setBusy }) => {
  const [err, setErr] = useState<string | null>(null);
  const setRole = async (role: AgentRole) => {
    if (role === agent.role) return;
    setErr(null);
    setBusy(true);
    try {
      await apiPost(`/agents/${agent.id}/role`, { role }, { authed: true });
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={S.roleSwitcher}>
      <span style={S.roleLabel}>Role</span>
      <div style={S.roleBtnRow}>
        {AGENT_ROLE_LIST.map((r) => (
          <button
            key={r}
            onClick={() => setRole(r)}
            disabled={busy || agent.role === r}
            title={ROLE_HINT[r]}
            style={{
              ...S.roleBtn,
              ...(agent.role === r ? S.roleBtnActive : {}),
            }}
          >
            {ROLE_LABEL[r]}
          </button>
        ))}
      </div>
      {err && <div style={S.formMsg}>{err}</div>}
    </div>
  );
};

/**
 * Reassign-agent flow — walks the same wizard as create, minus the
 * Name step. Pre-fills the agent's current role's category so simply
 * picking a different parcel works in two clicks. Calls
 * POST /agents/:id/reassign with { role, workplace_parcel_id }.
 *
 *   Step 1  Category    — change job category (or keep current)
 *   Step 2  Detail      — workplace picker, or item grid for Luxury
 *   Step 3  Confirm     — review + save
 */
const ReassignModal: React.FC<{
  agent: AgentRow;
  onClose: () => void;
  onDone: () => void;
}> = ({ agent, onClose, onDone }) => {
  // Pre-select the category that matches the agent's current role.
  // For role='produce'/'craft' we look at the current workplace's
  // category to bucket food/materials/energy/luxury; if there's no
  // workplace we default to 'food'.
  const initialCategory = useMemo<CategoryDef>(() => {
    if (agent.role === 'work') return CATEGORIES.find((c) => c.key === 'work')!;
    if (agent.role === 'craft') return CATEGORIES.find((c) => c.key === 'luxury')!;
    // role === 'produce'. We don't know the current building type from
    // the AgentRow alone; default to Food and let the user re-pick.
    return CATEGORIES.find((c) => c.key === 'food')!;
  }, [agent.role]);

  const [step, setStep] = useState<'category' | 'detail' | 'confirm'>('category');
  const [category, setCategory] = useState<CategoryDef>(initialCategory);
  const [workplaceId, setWorkplaceId] = useState<number | null>(null);
  const [workplaceLabel, setWorkplaceLabel] = useState<string>('');
  const [craftItem, setCraftItem] = useState<LuxuryItemKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = { role: category.role };
      if (workplaceId !== null) body.workplace_parcel_id = workplaceId;
      await apiPost(`/agents/${agent.id}/reassign`, body, { authed: true });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stepNumber = step === 'category' ? 1 : step === 'detail' ? 2 : 3;

  return (
    <div style={S.modalScrim} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalTitle}>
          Reassign {agent.name} — step {stepNumber} of 3
        </div>

        {step === 'category' && (
          <>
            <div style={S.modalNote}>What should <strong>{agent.name}</strong> make?</div>
            <div style={S.categoryGrid}>
              {CATEGORIES.filter((c) => c.key !== 'work').map((c) => (
                <button
                  key={c.key}
                  onClick={() => setCategory(c)}
                  style={{
                    ...S.categoryCard,
                    ...(category.key === c.key ? S.categoryCardActive : {}),
                  }}
                  title={c.hint}
                >
                  <div style={S.categoryIcon}>{c.icon}</div>
                  <div style={S.categoryLabel}>{c.label}</div>
                </button>
              ))}
            </div>
            <button
              onClick={() => setCategory(CATEGORIES.find((c) => c.key === 'work')!)}
              style={{
                ...S.categoryWideCard,
                ...(category.key === 'work' ? S.categoryCardActive : {}),
              }}
              title="Stand at a Housing or Civic building and earn a wage"
            >
              <span style={S.categoryIconInline}>💰</span>
              <span style={S.categoryWideLabel}>Work (Produce $AMETA)</span>
            </button>
            <div style={S.categoryHint}>{category.hint}</div>
            <div style={S.modalActions}>
              <button onClick={onClose} style={S.cancelTextBtn}>cancel</button>
              <button onClick={() => setStep('detail')} style={S.submit}>Next</button>
            </div>
          </>
        )}

        {step === 'detail' && category.key !== 'luxury' && (
          <WorkplaceStep
            buildingCategories={category.buildingCategories!}
            categoryLabel={category.label}
            selected={workplaceId}
            onPick={(id, label) => { setWorkplaceId(id); setWorkplaceLabel(label); }}
            onBack={() => setStep('category')}
            onContinue={() => setStep('confirm')}
            onCancel={onClose}
          />
        )}

        {step === 'detail' && category.key === 'luxury' && (
          <LuxuryItemStep
            selected={craftItem}
            onPick={(item, parcelId, label) => {
              setCraftItem(item);
              setWorkplaceId(parcelId);
              setWorkplaceLabel(label);
            }}
            onBack={() => setStep('category')}
            onContinue={() => setStep('confirm')}
            onCancel={onClose}
          />
        )}

        {step === 'confirm' && (
          <>
            <div style={S.confirmRow}>
              <span style={S.confirmIcon}>{category.icon}</span>
              <div>
                <div style={S.confirmName}>{agent.name}</div>
                <div style={S.confirmRole}>{category.label}</div>
              </div>
            </div>
            <div style={S.confirmDetails}>
              <div>
                Workplace: {workplaceId !== null ? workplaceLabel : 'unassigned (will idle)'}
              </div>
              {craftItem && (
                <div>Crafts: {LUXURY_ITEMS[craftItem].label}</div>
              )}
              <div style={{ fontSize: 10, color: '#7A6850', marginTop: 4 }}>
                No new agent purchase fee — this only updates the role + workplace.
              </div>
            </div>
            {err && <div style={S.errMsg}>{err}</div>}
            <div style={S.modalActions}>
              <button onClick={() => setStep('detail')} style={S.cancelTextBtn}>back</button>
              <button onClick={submit} disabled={busy} style={S.submit}>
                {busy ? '…' : 'Reassign'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ── Create-agent four-step wizard ──────────────────────────────────────
// Step 1: Job picker (8 cards)
// Step 2: Workplace picker (only for jobs that need one)
// Step 3: Name + initial fund
// Step 4: Confirm + spawn

/**
 * Create-agent flow — owner redesign 2026-05-20:
 *
 *   Step 1  Name        — name your agent (asked first)
 *   Step 2  Category    — pick what they make:
 *                          🌾 Food / ⛏️ Materials / ⚡ Energy / 💎 Luxury
 *                          + wide button below for "Work (Produce $AMETA)"
 *   Step 3  Detail      — depending on category:
 *                          produce → pick which owned production parcel
 *                          craft (luxury) → pick which luxury item to mint
 *                                           (auto-resolves to the matching parcel)
 *                          work → pick which Housing/Civic parcel
 *   Step 4  Confirm     — review + spawn
 *
 * The legacy JobId picker is removed from the UI. The server keeps a
 * job synonym internally for back-compat with the audit event payload.
 */
type CreateCategory = 'food' | 'materials' | 'energy' | 'luxury' | 'work';
type CreateStep = 'name' | 'category' | 'detail' | 'confirm';

interface CategoryDef {
  key: CreateCategory;
  label: string;
  icon: string;
  hint: string;
  role: 'work' | 'produce' | 'craft';
  // null for 'luxury' (the picker is an item grid, not a building list).
  buildingCategories: BuildingCategory[] | null;
}

const CATEGORIES: CategoryDef[] = [
  { key: 'food',      label: 'Food',      icon: '🌾', hint: 'Produce food at a Farm-chain building',         role: 'produce', buildingCategories: ['food'] },
  { key: 'materials', label: 'Materials', icon: '⛏️', hint: 'Produce materials at a Mine-chain building',    role: 'produce', buildingCategories: ['materials'] },
  { key: 'energy',    label: 'Energy',    icon: '⚡', hint: 'Produce energy at a Power-chain building',      role: 'produce', buildingCategories: ['energy'] },
  { key: 'luxury',    label: 'Luxury',    icon: '💎', hint: 'Craft a luxury item at one of your production buildings', role: 'craft',   buildingCategories: null },
  { key: 'work',      label: 'Work (Produce $AMETA)', icon: '💰', hint: 'Stand at a Housing or Civic building and earn a wage', role: 'work', buildingCategories: ['luxury-housing', 'luxury-civic'] },
];

const CreateAgentModal: React.FC<{
  onClose: () => void;
  onCreated: () => void;
}> = ({ onClose, onCreated }) => {
  const [step, setStep] = useState<CreateStep>('name');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<CategoryDef | null>(null);
  const [workplaceId, setWorkplaceId] = useState<number | null>(null);
  const [workplaceLabel, setWorkplaceLabel] = useState<string>('');
  const [craftItem, setCraftItem] = useState<LuxuryItemKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!category) return;
    setErr(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        role: category.role,
      };
      if (workplaceId !== null) body.workplace_parcel_id = workplaceId;
      const created = await apiPost<{ ok: boolean; agent: { id: string } }>(
        '/agents/register', body, { authed: true },
      );
      void created.agent.id;
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stepNumber = step === 'name' ? 1 : step === 'category' ? 2 : step === 'detail' ? 3 : 4;

  return (
    <div style={S.modalScrim} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalTitle}>
          New agent — step {stepNumber} of 4
        </div>

        {step === 'name' && (
          <>
            <div style={S.modalNote}>
              Name your agent. Spawning costs <strong>200,000 $AMETA</strong> from your wallet.
            </div>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Name (unique)" maxLength={32}
              style={S.input} autoFocus
            />
            <div style={S.modalActions}>
              <button onClick={onClose} style={S.cancelTextBtn}>cancel</button>
              <button
                onClick={() => setStep('category')}
                disabled={!name.trim()}
                style={S.submit}
              >
                Next
              </button>
            </div>
          </>
        )}

        {step === 'category' && (
          <>
            <div style={S.modalNote}>What do you want <strong>{name}</strong> to make?</div>
            <div style={S.categoryGrid}>
              {CATEGORIES.filter((c) => c.key !== 'work').map((c) => (
                <button
                  key={c.key}
                  onClick={() => setCategory(c)}
                  style={{
                    ...S.categoryCard,
                    ...(category?.key === c.key ? S.categoryCardActive : {}),
                  }}
                  title={c.hint}
                >
                  <div style={S.categoryIcon}>{c.icon}</div>
                  <div style={S.categoryLabel}>{c.label}</div>
                </button>
              ))}
            </div>
            <button
              onClick={() => setCategory(CATEGORIES.find((c) => c.key === 'work') ?? null)}
              style={{
                ...S.categoryWideCard,
                ...(category?.key === 'work' ? S.categoryCardActive : {}),
              }}
              title="Stand at a Housing or Civic building and earn a wage"
            >
              <span style={S.categoryIconInline}>💰</span>
              <span style={S.categoryWideLabel}>Work (Produce $AMETA)</span>
            </button>
            {category && (
              <div style={S.categoryHint}>{category.hint}</div>
            )}
            <div style={S.modalActions}>
              <button onClick={() => setStep('name')} style={S.cancelTextBtn}>back</button>
              <button
                onClick={() => setStep('detail')}
                disabled={!category}
                style={S.submit}
              >
                Next
              </button>
            </div>
          </>
        )}

        {step === 'detail' && category && category.key !== 'luxury' && (
          <WorkplaceStep
            buildingCategories={category.buildingCategories!}
            categoryLabel={category.label}
            selected={workplaceId}
            onPick={(id, label) => { setWorkplaceId(id); setWorkplaceLabel(label); }}
            onBack={() => setStep('category')}
            onContinue={() => setStep('confirm')}
            onCancel={onClose}
          />
        )}

        {step === 'detail' && category && category.key === 'luxury' && (
          <LuxuryItemStep
            selected={craftItem}
            onPick={(item, parcelId, label) => {
              setCraftItem(item);
              setWorkplaceId(parcelId);
              setWorkplaceLabel(label);
            }}
            onBack={() => setStep('category')}
            onContinue={() => setStep('confirm')}
            onCancel={onClose}
          />
        )}

        {step === 'confirm' && category && (
          <>
            <div style={S.confirmRow}>
              <span style={S.confirmIcon}>{category.icon}</span>
              <div>
                <div style={S.confirmName}>{name}</div>
                <div style={S.confirmRole}>{category.label}</div>
              </div>
            </div>
            <div style={S.confirmDetails}>
              <div>
                Workplace:{' '}
                {workplaceId !== null
                  ? workplaceLabel
                  : category.key === 'luxury'
                    ? 'auto — pick an item first'
                    : 'unassigned (will idle until reassigned)'}
              </div>
              {craftItem && (
                <div>Crafts: {LUXURY_ITEMS[craftItem].label}</div>
              )}
              <div>Purchase cost: 200,000 $AMETA (from wallet)</div>
            </div>
            {err && <div style={S.errMsg}>{err}</div>}
            <div style={S.modalActions}>
              <button onClick={() => setStep('detail')} style={S.cancelTextBtn}>back</button>
              <button onClick={submit} disabled={busy} style={S.submit}>
                {busy ? '…' : 'Spawn agent'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/**
 * Workplace picker — generalized to accept one or more BuildingCategory
 * filters instead of a single building type. Used by Food/Materials/Energy
 * (single production category) and Work (housing + civic combined).
 */
const WorkplaceStep: React.FC<{
  buildingCategories: BuildingCategory[];
  categoryLabel: string;
  selected: number | null;
  onPick: (parcelId: number, label: string) => void;
  onBack: () => void;
  onContinue: () => void;
  onCancel: () => void;
}> = ({ buildingCategories, categoryLabel, selected, onPick, onBack, onContinue, onCancel }) => {
  const [owned, setOwned] = useState<WorldParcel[] | null>(null);
  const [foreignCount, setForeignCount] = useState<number>(0);
  const myWallet = (() => { try { return localStorage.getItem('tl_player_id'); } catch { return null; } })();

  useEffect(() => {
    apiGet<WorldResp>('/world')
      .then((r) => {
        const matching = r.parcels_data.filter((p) => {
          const bt = p.business_type as BuildingType;
          const spec = BUILDINGS[bt];
          return spec && buildingCategories.includes(spec.category);
        });
        const mine = matching.filter((p) => p.owner_id === myWallet);
        const foreign = matching.filter((p) => p.owner_id !== myWallet);
        setOwned(mine);
        setForeignCount(foreign.length);
      })
      .catch(() => { setOwned([]); });
  }, [myWallet, buildingCategories.join(',')]);

  return (
    <>
      <div style={S.modalNote}>Pick a {categoryLabel.toLowerCase()} building to work at.</div>
      {!owned && <div style={S.formMsg}>Loading your buildings…</div>}
      {owned && owned.length === 0 && (
        <div style={S.modalNote}>
          You don't own any {categoryLabel.toLowerCase()} buildings yet.
          {foreignCount > 0 && (
            <>
              {' '}Skip below and your agent will work at one of the {foreignCount}
              {' '}existing {categoryLabel.toLowerCase()} building{foreignCount === 1 ? '' : 's'}
              {' '}owned by other players.
            </>
          )}
        </div>
      )}
      {owned && owned.length > 0 && (
        <div style={S.parcelList}>
          {owned.map((p) => {
            const bt = p.business_type as BuildingType;
            const spec = BUILDINGS[bt];
            const label = spec?.label ?? bt;
            return (
              <button
                key={p.id}
                onClick={() => onPick(p.id, `#${p.id} — ${p.business_name || label}`)}
                style={{ ...S.parcelOption, ...(selected === p.id ? S.parcelOptionActive : {}) }}
              >
                <div style={S.parcelOptionTitle}>
                  #{p.id} — {p.business_name || label}
                </div>
                <div style={S.parcelOptionMeta}>
                  {label} · grid ({p.grid_x}, {p.grid_y})
                </div>
              </button>
            );
          })}
        </div>
      )}
      <div style={S.modalActions}>
        <button onClick={onCancel} style={S.cancelTextBtn}>cancel</button>
        <button onClick={onBack} style={S.cancelTextBtn}>back</button>
        <button onClick={onContinue} disabled={selected === null && (owned?.length ?? 0) > 0} style={S.submit}>
          Next
        </button>
      </div>
    </>
  );
};

/**
 * Luxury crafting picker — grid of all 15 luxury items. Each item is
 * enabled only if the player owns at least one matching production
 * building. Picking an item auto-resolves the workplace to the first
 * owned matching parcel (sufficient for v1; multi-building owners can
 * later reassign from the agent card).
 */
const LuxuryItemStep: React.FC<{
  selected: LuxuryItemKind | null;
  onPick: (item: LuxuryItemKind, parcelId: number, label: string) => void;
  onBack: () => void;
  onContinue: () => void;
  onCancel: () => void;
}> = ({ selected, onPick, onBack, onContinue, onCancel }) => {
  const [parcels, setParcels] = useState<WorldParcel[] | null>(null);
  const myWallet = (() => { try { return localStorage.getItem('tl_player_id'); } catch { return null; } })();

  useEffect(() => {
    apiGet<WorldResp>('/world')
      .then((r) => {
        setParcels(r.parcels_data.filter((p) => p.owner_id === myWallet));
      })
      .catch(() => { setParcels([]); });
  }, [myWallet]);

  const items = Object.values(LUXURY_ITEMS);
  const ownedBuildings = new Set((parcels ?? []).map((p) => p.business_type));

  return (
    <>
      <div style={S.modalNote}>
        Pick a luxury item to craft. Greyed-out items require building you don't yet own.
      </div>
      {!parcels && <div style={S.formMsg}>Loading your buildings…</div>}
      {parcels && (
        <div style={S.itemGrid}>
          {items.map((item) => {
            const ownsBuilding = ownedBuildings.has(item.building);
            const isSelected = selected === item.kind;
            return (
              <button
                key={item.kind}
                disabled={!ownsBuilding}
                onClick={() => {
                  const parcel = (parcels ?? []).find((p) => p.business_type === item.building);
                  if (parcel) {
                    onPick(item.kind, parcel.id, `#${parcel.id} — ${parcel.business_name || (BUILDINGS[item.building as BuildingType]?.label ?? item.building)}`);
                  }
                }}
                style={{
                  ...S.itemSlot,
                  ...(ownsBuilding ? S.itemSlotEnabled : S.itemSlotDisabled),
                  ...(isSelected ? S.itemSlotActive : {}),
                }}
                title={ownsBuilding
                  ? `${item.label} — crafted at ${item.building} · yields ${item.burnValue} luxury`
                  : `Requires a ${BUILDINGS[item.building as BuildingType]?.label ?? item.building} (you don't own one)`}
              >
                <div style={S.itemSlotIcon}>
                  {/* Use the catalog icon if we have it client-side, else a chain glyph. */}
                  {INVENTORY_CATALOG.find((c) => c.kind === item.kind)?.icon ?? '✨'}
                </div>
                <div style={S.itemSlotLabel}>{item.label}</div>
                <div style={S.itemSlotMeta}>T{item.tier} · {item.chain}</div>
              </button>
            );
          })}
        </div>
      )}
      <div style={S.modalActions}>
        <button onClick={onCancel} style={S.cancelTextBtn}>cancel</button>
        <button onClick={onBack} style={S.cancelTextBtn}>back</button>
        <button onClick={onContinue} disabled={selected === null} style={S.submit}>
          Next
        </button>
      </div>
    </>
  );
};

// (ApiKeyModal removed 2026-05-16 — the create flow no longer surfaces
//  the API key. Owners can reveal it later via the Advanced disclosure
//  on the agent card, which calls GET /api/v1/agents/:id/api-key.)

// ── Wallet tab — connect / disconnect ─────────────────────────────────
//
// For testing this is an explicit Phone app. The longer-term plan is that
// the game won't open until you've signed in with a wallet (i.e. wallet
// auth becomes a gate, not an opt-in). Until then this lives here so a
// human player can try the wallet → agents flow without leaving the game.

const WalletBody: React.FC = () => {
  const [addr, setAddr] = useState<string | null>(() => {
    const pid = getStoredPlayerId();
    return pid && /^0x[a-fA-F0-9]{40}$/.test(pid) && getStoredAuthToken() ? pid : null;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hasWallet = hasInjectedWallet();

  const connect = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await connectWallet();
      setAddr(r.address);
      // Reload so Colyseus reconnects with the wallet identity. Without
      // this, the active room is still bound to the prior guest UUID.
      window.location.reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await logoutWallet();
      setAddr(null);
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={S.walletWrap}>
      {addr ? (
        <>
          <div style={S.walletStatus}>Connected</div>
          <div style={S.walletAddr} title={addr}>
            {addr.slice(0, 6)}…{addr.slice(-4)}
          </div>
          <div style={S.walletHint}>
            Your in-game progress, agents, and market orders are now bound to this wallet.
          </div>
          <button
            onClick={disconnect}
            disabled={busy}
            style={S.walletDangerBtn}
          >
            {busy ? '…' : 'Disconnect wallet'}
          </button>
        </>
      ) : (
        <>
          <div style={S.walletStatus}>Guest mode</div>
          <div style={S.walletHint}>
            You're playing as a browser-local guest. Connect a wallet to claim a persistent identity, spawn agents, and trade on the market.
          </div>
          {hasWallet ? (
            <button
              onClick={connect}
              disabled={busy}
              style={S.walletPrimaryBtn}
            >
              {busy ? 'Connecting…' : 'Connect wallet'}
            </button>
          ) : (
            <div style={S.walletHint}>
              No browser wallet detected. Install MetaMask, Rabby, or another EIP-1193 wallet to continue.
            </div>
          )}
          {err && <div style={S.errMsg}>{err}</div>}
        </>
      )}
    </div>
  );
};

// ── Inventory app — luxury items grid + use-on-click ───────────────────
//
// Each player has a 15-slot inventory (one slot per named luxury item
// from the spec §4 catalog). Clicking a slot opens the burn dialog;
// confirming burns the chosen quantity for rank points. Slots with no
// owned quantity render greyed out — they're "where each item will go"
// so players see the full catalog even when empty.

interface InventoryResp {
  items: Record<string, number>;
  lifetime_luxury_burned: number;
}

// 15-item catalog (matches packages/shared LUXURY_ITEMS exactly). Defined
// here to avoid the client-side bundle pulling all the server-side bits
// from the shared package. Each entry: kind id, chain icon, label, tier,
// burn value.
type ItemChain = 'food' | 'materials' | 'energy';
interface InvItem {
  kind: string;
  chain: ItemChain;
  tier: 1 | 2 | 3 | 4 | 5;
  burnValue: number;
  label: string;
  icon: string;
}
const INVENTORY_CATALOG: InvItem[] = [
  // Food chain
  { kind: 'artisan_jam',       chain: 'food', tier: 1, burnValue: 1,  label: 'Artisan Jam',           icon: '🍯' },
  { kind: 'aged_charcuterie',  chain: 'food', tier: 2, burnValue: 3,  label: 'Aged Charcuterie',      icon: '🥩' },
  { kind: 'heirloom_truffle',  chain: 'food', tier: 3, burnValue: 6,  label: 'Heirloom Truffle',      icon: '🍄' },
  { kind: 'imperial_caviar',   chain: 'food', tier: 4, burnValue: 12, label: 'Imperial Caviar',       icon: '🥚' },
  { kind: 'designer_wagyu',    chain: 'food', tier: 5, burnValue: 25, label: 'Designer Wagyu',        icon: '🥩' },
  // Materials chain
  { kind: 'cut_gemstone',      chain: 'materials', tier: 1, burnValue: 1,  label: 'Cut Gemstone',     icon: '💎' },
  { kind: 'forged_sculpture',  chain: 'materials', tier: 2, burnValue: 3,  label: 'Forged Sculpture', icon: '🗿' },
  { kind: 'polished_marble',   chain: 'materials', tier: 3, burnValue: 6,  label: 'Polished Marble',  icon: '🏛️' },
  { kind: 'carbon_weave',      chain: 'materials', tier: 4, burnValue: 12, label: 'Carbon-Weave Art', icon: '🎨' },
  { kind: 'quantum_display',   chain: 'materials', tier: 5, burnValue: 25, label: 'Quantum Display',  icon: '🖥️' },
  // Energy chain
  { kind: 'aaa_battery',       chain: 'energy', tier: 1, burnValue: 1,  label: 'AAA Battery',        icon: '🔋' },
  { kind: 'aa_battery',        chain: 'energy', tier: 2, burnValue: 3,  label: 'AA Battery',         icon: '🔋' },
  { kind: '9v_battery',        chain: 'energy', tier: 3, burnValue: 6,  label: '9V Battery',         icon: '🔋' },
  { kind: 'industrial_cell',   chain: 'energy', tier: 4, burnValue: 12, label: 'Industrial Cell',    icon: '⚡' },
  { kind: 'fusion_core',       chain: 'energy', tier: 5, burnValue: 25, label: 'Fusion Core',        icon: '☢️' },
];

const TIER_COLOR: Record<number, string> = {
  1: '#CD7F32', // bronze
  2: '#C0C0C0', // silver
  3: '#FFD700', // gold
  4: '#E5E4E2', // platinum
  5: '#B9F2FF', // diamond
};

const InventoryBody: React.FC = () => {
  const [data, setData] = useState<InventoryResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<InvItem | null>(null);
  const signedIn = hasAuthToken();

  const refresh = useCallback(() => {
    if (!signedIn) return;
    apiGet<InventoryResp>('/wallet/items', { authed: true })
      .then((r) => { setData(r); setErr(null); })
      .catch((e) => setErr((e as Error).message));
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    refresh();
    const i = setInterval(refresh, 6000);
    return () => clearInterval(i);
  }, [signedIn, refresh]);

  if (!signedIn) {
    return (
      <div style={S.emptyPad}>
        Connect a wallet to see your luxury items.
      </div>
    );
  }

  const items = data?.items ?? {};
  const lifetime = data?.lifetime_luxury_burned ?? 0;
  return (
    <>
      <div style={S.invHeader}>
        <span style={S.invHeaderLabel}>Lifetime luxury used</span>
        <span style={S.invHeaderValue}>{lifetime.toLocaleString()}</span>
      </div>
      {err && <div style={S.errMsg}>{err}</div>}
      <div style={S.invGrid}>
        {INVENTORY_CATALOG.map((item) => {
          const qty = items[item.kind] ?? 0;
          const owned = qty > 0;
          return (
            <button
              key={item.kind}
              onClick={() => owned && setSelected(item)}
              disabled={!owned}
              style={{
                ...S.invSlot,
                ...(owned ? S.invSlotOwned : {}),
                borderColor: TIER_COLOR[item.tier],
              }}
              title={`${item.label} · Tier ${item.tier} · yields ${item.burnValue} luxury when used`}
              aria-label={`${item.label}, ${qty} owned`}
            >
              <span style={S.invIcon}>{item.icon}</span>
              <span style={S.invQty}>{owned ? qty : '—'}</span>
              <span style={S.invName}>{item.label}</span>
            </button>
          );
        })}
      </div>
      {selected && (
        <BurnDialog
          item={selected}
          owned={items[selected.kind] ?? 0}
          onClose={() => setSelected(null)}
          onBurned={() => { setSelected(null); refresh(); }}
        />
      )}
    </>
  );
};

const BurnDialog: React.FC<{
  item: InvItem;
  owned: number;
  onClose: () => void;
  onBurned: () => void;
}> = ({ item, owned, onClose, onBurned }) => {
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = parseInt(qty, 10);
  const validN = Number.isFinite(n) && n > 0 && n <= owned;
  const gained = validN ? n * item.burnValue : 0;

  const submit = async () => {
    if (!validN) return;
    setBusy(true);
    setErr(null);
    try {
      await apiPost('/actions/burn', { item_kind: item.kind, quantity: n }, { authed: true });
      // Notify other UI surfaces (Rank app, resource-bar luxury fill) so
      // they refresh without waiting for a poll cycle.
      window.dispatchEvent(new CustomEvent('burn-result', { detail: { kind: item.kind, qty: n } }));
      onBurned();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={S.burnBackdrop} onClick={onClose} role="dialog" aria-label="Use luxury item">
      <div style={S.burnPanel} onClick={(e) => e.stopPropagation()}>
        <div style={S.burnHead}>
          <span style={S.burnIcon}>{item.icon}</span>
          <span style={S.burnTitle}>{item.label}</span>
        </div>
        <div style={S.burnMeta}>
          Tier {item.tier} · yields <strong>{item.burnValue}</strong> luxury each
        </div>
        <div style={S.burnMeta}>You own: <strong>{owned}</strong></div>
        <div style={S.burnRow}>
          <label style={S.burnLabel}>Use</label>
          <input
            type="number" min={1} max={owned} step={1} value={qty}
            onChange={(e) => setQty(e.target.value)}
            style={S.input}
            autoFocus
          />
          <button onClick={() => setQty(String(owned))} style={S.maxBtn}>Max</button>
        </div>
        {validN && (
          <div style={S.burnGained}>
            +{gained.toLocaleString()} luxury
          </div>
        )}
        {err && <div style={S.formMsg}>{err}</div>}
        <div style={S.burnActions}>
          <button onClick={onClose} disabled={busy} style={S.cancelTextBtn}>cancel</button>
          <button onClick={submit} disabled={busy || !validN} style={S.dangerBtn}>
            {busy ? '…' : 'Use'}
          </button>
        </div>
      </div>
    </div>
  );
};

const EventBody: React.FC = () => {
  const [severity, setSeverity] = useState<Severity>('all');
  const [events, setEvents] = useState<EventRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const q = severity === 'all' ? '' : `?severity=${severity}`;
      apiGet<{ events: EventRow[] }>(`/events${q}`)
        .then((r) => { if (!cancelled) setEvents(r.events); })
        .catch(() => {});
    };
    load();
    const i = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(i); };
  }, [severity]);

  return (
    <>
      <div style={S.tabRow}>
        {(Object.keys(SEVERITY_LABEL) as Severity[]).map((s) => (
          <button key={s} onClick={() => setSeverity(s)} style={{ ...S.tab, ...(s === severity ? S.tabActive : {}) }}>
            {SEVERITY_LABEL[s]}
          </button>
        ))}
      </div>
      <div style={S.list}>
        {events.length === 0 ? (
          <div style={S.empty}>No events</div>
        ) : (
          events.slice(0, 60).map((e) => (
            <div key={e.id} style={S.row}>
              <span
                style={{ ...S.badge, background: SEVERITY_COLOR[e.severity] ?? '#8b8b9a' }}
                aria-label={`Severity ${e.severity}`}
              />
              <span style={S.text}>{summarizeEvent(e)}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
};

// PropertiesBody removed 2026-05-20 with the sub-unit retirement.
// The 'properties' AppId is still in the union for AppDef typing but
// has no entry in APPS and no dispatcher case below.

const LANDMARK_GLYPH: Record<string, string> = {
  town_hall: '★', plaza: '◆', monument: '♦', gate: '⌂', park: '✿', harbor: '⚓',
};

interface DecreeRow {
  id: number;
  proposer_id: string;
  subject: string;
  body: string;
  action_type: string;
  action_params: unknown;
  proposed_at_tick: number;
  vote_window_ticks: number;
  status: 'active' | 'passed' | 'rejected' | 'executed';
  resolved_at_tick: number | null;
}

const STATUS_COLOR: Record<DecreeRow['status'], string> = {
  active: '#D89438', passed: '#3F7A3D', rejected: '#B5563A', executed: '#7A4F2E',
};

const GovernanceBody: React.FC = () => {
  const [activeDecrees, setActiveDecrees] = useState<DecreeRow[]>([]);
  const [recentDecrees, setRecentDecrees] = useState<DecreeRow[]>([]);
  const [tab, setTab] = useState<'active' | 'recent'>('active');

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      apiGet<{ decrees: DecreeRow[] }>('/governance/active')
        .then((r) => { if (!cancelled) setActiveDecrees(r.decrees); })
        .catch(() => {});
      apiGet<{ decrees: DecreeRow[] }>('/governance/recent')
        .then((r) => { if (!cancelled) setRecentDecrees(r.decrees); })
        .catch(() => {});
    };
    load();
    const i = setInterval(load, 12_000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  const list = tab === 'active' ? activeDecrees : recentDecrees;

  return (
    <>
      <div style={S.tabRow}>
        <button onClick={() => setTab('active')} style={{ ...S.tab, ...(tab === 'active' ? S.tabActive : {}) }}>
          Active
        </button>
        <button onClick={() => setTab('recent')} style={{ ...S.tab, ...(tab === 'recent' ? S.tabActive : {}) }}>
          Recent
        </button>
      </div>
      <div style={S.list}>
        {list.length === 0 ? (
          <div style={S.empty}>{tab === 'active' ? 'No open decrees' : 'No decree history'}</div>
        ) : (
          list.slice(0, 30).map((d) => (
            <div key={d.id} style={S.decreeRow}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ ...S.decreeStatus, color: STATUS_COLOR[d.status] }}>{d.status}</span>
                <span style={S.decreeSubject}>{d.subject}</span>
              </div>
              <div style={S.decreeMeta}>
                #{d.id} · {d.action_type} · window {d.vote_window_ticks}t · proposer {d.proposer_id.slice(0, 8)}
              </div>
            </div>
          ))
        )}
      </div>
      <div style={S.foot}>
        Propose / vote via <code>POST /api/v1/governance/propose</code> or <code>/vote</code>.
      </div>
    </>
  );
};

interface WorldParcelLite { id: number; grid_x: number; grid_y: number; color: string; }

const World2DBody: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [parcels, setParcels] = useState<WorldParcelLite[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiGet<{ parcels_data: WorldParcelLite[] }>('/world')
        .then((w) => { if (!cancelled) setParcels(w.parcels_data ?? []); })
        .catch(() => {});
    load();
    const i = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const W = c.width, H = c.height;
    const cellW = W / GRID_COLS;
    const cellH = H / GRID_ROWS;

    ctx.fillStyle = '#1A1812';
    ctx.fillRect(0, 0, W, H);

    // Claimed parcels
    for (const p of parcels) {
      ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#4a90d9';
      ctx.fillRect(p.grid_x * cellW + 1, p.grid_y * cellH + 1, cellW - 2, cellH - 2);
    }

    // Grid lines (light)
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.5;
    for (let gx = 0; gx <= GRID_COLS; gx += 5) {
      ctx.beginPath();
      ctx.moveTo(gx * cellW, 0); ctx.lineTo(gx * cellW, H); ctx.stroke();
    }
    for (let gy = 0; gy <= GRID_ROWS; gy += 5) {
      ctx.beginPath();
      ctx.moveTo(0, gy * cellH); ctx.lineTo(W, gy * cellH); ctx.stroke();
    }

    // Landmarks
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 14px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const lm of LANDMARKS) {
      const gx = Math.floor(lm.parcelId / GRID_COLS);
      const gy = lm.parcelId % GRID_COLS;
      const x = gx * cellW + cellW / 2;
      const y = gy * cellH + cellH / 2;
      ctx.fillStyle = lm.type === 'town_hall' ? '#FFFFFF' : '#FFE08A';
      ctx.fillText(LANDMARK_GLYPH[lm.type] ?? '◆', x, y);
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'top';
  }, [parcels]);

  return (
    <>
      <div style={{ fontSize: 11, color: '#8b8b9a', marginBottom: 6 }}>
        45×45 grid · {parcels.length} claimed parcels
      </div>
      <canvas ref={canvasRef} width={320} height={320} style={{ width: '100%', borderRadius: 4 }} />
      <div style={S.symbolLegend}>
        <span style={S.legendItem}><span style={{ ...S.legendGlyph, color: '#FFFFFF' }} aria-hidden>★</span> Town Hall</span>
        <span style={S.legendItem}><span style={{ ...S.legendGlyph, color: '#FFE08A' }} aria-hidden>⌂</span> Gate</span>
        <span style={S.legendItem}><span style={{ ...S.legendGlyph, color: '#FFE08A' }} aria-hidden>♦</span> Monument</span>
        <span style={S.legendItem}><span style={{ ...S.legendGlyph, color: '#FFE08A' }} aria-hidden>✿</span> Park</span>
        <span style={S.legendItem}><span style={{ ...S.legendGlyph, color: '#FFE08A' }} aria-hidden>⚓</span> Harbor</span>
        <span style={S.legendItem}><span style={{ ...S.legendGlyph, color: '#4A90D9' }} aria-hidden>■</span> Claimed parcel (color = owner)</span>
      </div>
    </>
  );
};

// ── Rank app ──────────────────────────────────────────────────────────
//
// Reads /wallet/rank for live progress + benefits, refreshes on the
// 'burn-result' window event so a burn from the Inventory app updates
// the rank panel immediately. Falls back to a "no rank yet" CTA when
// the wallet has never burned a luxury item.

type RankTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
interface RankSnapshot {
  lifetime: number;
  rank: RankTier | null;
  next_rank: RankTier | null;
  prev_threshold: number;
  next_threshold: number | null;
  progress: number; // 0..1
  benefits: {
    in_game_agent_cap: number;
    external_agent_cap: number;
    land_cap: number;
    marketplace_fee_bps: number;
  };
}

const RANK_TIER_COLOR: Record<RankTier, string> = {
  bronze:   '#CD7F32',
  silver:   '#C0C0C0',
  gold:     '#FFD700',
  platinum: '#E5E4E2',
  diamond:  '#B9F2FF',
};
const RANK_TIER_LABEL: Record<RankTier, string> = {
  bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', diamond: 'Diamond',
};

const RankBody: React.FC = () => {
  const [snap, setSnap] = useState<RankSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!hasAuthToken()) {
      setErr('Connect your wallet to view rank progress.');
      return;
    }
    try {
      const r = await apiGet<RankSnapshot>('/wallet/rank', { authed: true });
      setSnap(r);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onBurn = () => refresh();
    window.addEventListener('burn-result', onBurn);
    return () => window.removeEventListener('burn-result', onBurn);
  }, [refresh]);

  if (err) return <div style={S.rankErr}>{err}</div>;
  if (!snap) return <div style={S.rankLoading}>Loading rank…</div>;

  const current = snap.rank;
  const next = snap.next_rank;
  const pct = Math.round(snap.progress * 100);
  const toGo =
    snap.next_threshold != null ? Math.max(0, snap.next_threshold - snap.lifetime) : 0;

  return (
    <div style={S.rankWrap}>
      <div style={S.rankCard}>
        <div
          style={{
            ...S.rankCrest,
            background: current
              ? `radial-gradient(circle at 35% 30%, ${RANK_TIER_COLOR[current]}, ${RANK_TIER_COLOR[current]}99 60%, ${RANK_TIER_COLOR[current]}33)`
              : 'rgba(245,230,208,0.08)',
            boxShadow: current ? `0 0 18px ${RANK_TIER_COLOR[current]}99` : 'none',
            color: current ? '#1f1812' : '#A89378',
          }}
          aria-label={current ? `${RANK_TIER_LABEL[current]} crest` : 'No rank'}
        >
          {current ? RANK_TIER_LABEL[current][0] : '–'}
        </div>
        <div style={S.rankCardRight}>
          <div style={S.rankLabel}>Current rank</div>
          <div style={S.rankTitle}>
            {current ? RANK_TIER_LABEL[current] : 'Unranked'}
          </div>
          <div style={S.rankLifetime}>
            Lifetime luxury used:{' '}
            <strong style={{ color: '#F5E6D0' }}>{snap.lifetime.toLocaleString()}</strong>
          </div>
        </div>
      </div>

      {next ? (
        <div style={S.rankProgressSection}>
          <div style={S.rankProgressLabel}>
            <span>
              Progress to <strong style={{ color: RANK_TIER_COLOR[next] }}>{RANK_TIER_LABEL[next]}</strong>
            </span>
            <span>{pct}%</span>
          </div>
          <div style={S.rankProgressTrack}>
            <div
              style={{
                ...S.rankProgressFill,
                width: `${pct}%`,
                background: `linear-gradient(90deg, ${RANK_TIER_COLOR[next]}, ${RANK_TIER_COLOR[next]}cc)`,
              }}
            />
          </div>
          <div style={S.rankProgressFooter}>
            <span>
              {snap.lifetime.toLocaleString()} / {(snap.next_threshold ?? 0).toLocaleString()}
            </span>
            <span>{toGo.toLocaleString()} to go</span>
          </div>
        </div>
      ) : (
        <div style={S.rankMaxedOut}>
          Maximum rank reached — you are Diamond.
        </div>
      )}

      <div style={S.rankBenefitsSection}>
        <div style={S.rankBenefitsHeader}>Current rank benefits</div>
        <div style={S.rankBenefitsGrid}>
          <Benefit label="In-game agents" value={snap.benefits.in_game_agent_cap} />
          <Benefit label="External agents" value={snap.benefits.external_agent_cap} />
          <Benefit label="Land cap" value={snap.benefits.land_cap} />
          <Benefit
            label="Market fee"
            value={`${(snap.benefits.marketplace_fee_bps / 100).toFixed(0)}%`}
          />
        </div>
      </div>

      <div style={S.rankHint}>
        Rank progress comes from two sources: passive luxury produced by your
        Housing and Civic buildings, and the luxury value of items you use.
        Higher ranks unlock more agents, more land, and lower marketplace fees.
      </div>
    </div>
  );
};

const Benefit: React.FC<{ label: string; value: number | string }> = ({ label, value }) => (
  <div style={S.rankBenefitItem}>
    <div style={S.rankBenefitValue}>{value}</div>
    <div style={S.rankBenefitLabel}>{label}</div>
  </div>
);

const S: Record<string, React.CSSProperties> = {
  // ── Floating phone-icon FAB ──────────────────────────────────────────
  fab: {
    position: 'absolute', bottom: 16, right: 16, zIndex: 12,
    width: 56, height: 56, borderRadius: 28,
    background: '#2A1F18', color: '#F5E6D0',
    borderWidth: 2, borderStyle: 'solid', borderColor: '#D89438',
    cursor: 'pointer', pointerEvents: 'auto',
    boxShadow: '0 4px 20px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
    fontFamily: 'sans-serif',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  fabActive: { background: '#3F7A3D', borderColor: '#F5E6D0' },
  fabIcon: { fontSize: 26 },

  // ── Phone frame ──────────────────────────────────────────────────────
  phoneFrame: {
    position: 'absolute', bottom: 88, right: 16, zIndex: 13,
    width: 320, height: 580,
    background: '#1A1410',
    borderRadius: 38,
    padding: 8,
    boxShadow: '0 8px 40px rgba(0,0,0,0.6), inset 0 0 0 2px rgba(216,148,56,0.18)',
    pointerEvents: 'auto',
    fontFamily: 'sans-serif',
  },
  phoneScreen: {
    width: '100%', height: '100%',
    background: '#1F1812',
    borderRadius: 30,
    overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
    color: '#F5E6D0',
  },

  // ── Status bar / notch ──────────────────────────────────────────────
  statusBar: {
    height: 28, padding: '4px 16px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    fontSize: 11, color: '#e4e4ef', position: 'relative',
  },
  statusTime: { fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 30, color: '#F5E6D0' },
  notch: {
    position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)',
    width: 80, height: 18, background: '#0E0A07', borderRadius: 12,
  },
  statusRight: { fontFamily: 'monospace', fontSize: 9, color: '#A89378', minWidth: 30, textAlign: 'right' },

  // ── Screen content + home indicator ─────────────────────────────────
  screenContent: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  homeIndicator: {
    height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
  },
  homeBar: {
    width: 100, height: 4, borderRadius: 2,
    background: 'rgba(255,255,255,0.4)',
  },

  // ── Home wallpaper — warm dusk gradient over a textured tan ─────────
  homeWallpaper: {
    flex: 1, padding: '20px 16px',
    background: 'linear-gradient(165deg, #3F2A1B 0%, #6B4226 50%, #B5563A 100%)',
    display: 'flex', flexDirection: 'column',
  },
  homeTitle: {
    fontSize: 15, color: '#F5E6D0',
    textAlign: 'center', marginBottom: 16,
    textShadow: '0 1px 3px rgba(0,0,0,0.6)',
    letterSpacing: 1,
    fontFamily: 'Georgia, "Source Serif", serif',
    fontWeight: 600,
  },
  appGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16,
    justifyItems: 'center',
  },
  appTileBtn: {
    background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
    width: 72,
  },
  appIcon: {
    width: 60, height: 60, borderRadius: 14,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 3px 8px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.18)',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(0,0,0,0.25)',
  },
  appEmoji: { fontSize: 28, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' },
  appLabel: { fontSize: 10, color: '#F5E6D0', textAlign: 'center', textShadow: '0 1px 2px rgba(0,0,0,0.6)' },

  // ── App view (post-launch) ──────────────────────────────────────────
  appView: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  appHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 12px',
    background: '#2A1F18',
    borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'rgba(216,148,56,0.20)',
  },
  backBtn: {
    width: 28, height: 28, borderRadius: 14,
    background: 'rgba(245,230,208,0.10)', color: '#F5E6D0',
    border: 'none', cursor: 'pointer', fontSize: 16,
  },
  appHeaderTitle: {
    fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6,
    color: '#F5E6D0',
    fontFamily: 'Georgia, "Source Serif", serif',
  },
  appHeaderIcon: { fontSize: 14 },
  appBody: {
    flex: 1, overflowY: 'auto', padding: 10,
    background: '#1F1812',
    color: '#F5E6D0',
  },

  // ── Body inner styles (existing — used by panel bodies) ─────────────
  tabRow: { display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' },
  tab: {
    flex: '1 1 auto', minWidth: 50, fontSize: 11, padding: '4px 6px',
    background: 'transparent', color: '#A89378',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(216,148,56,0.18)', borderRadius: 6, cursor: 'pointer',
    textTransform: 'capitalize' as const,
  },
  tabActive: { color: '#F5E6D0', background: 'rgba(216,148,56,0.18)', borderColor: '#D89438' },
  list: { display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 320, overflowY: 'auto' },
  row: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '2px 4px' },
  rank: { width: 24, color: '#A89378', fontVariantNumeric: 'tabular-nums' },
  name: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  valueG: { fontVariantNumeric: 'tabular-nums', color: '#D89438' },
  badge: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  text: { color: '#F5E6D0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cols: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 },
  colHeader: { fontSize: 11, color: '#A89378', marginTop: 4, marginBottom: 4, fontFamily: 'Georgia, serif' },
  level: { display: 'flex', justifyContent: 'space-between', fontSize: 12, fontVariantNumeric: 'tabular-nums', padding: '2px 4px' },
  trades: { display: 'flex', flexDirection: 'column', gap: 2 },
  trade: { fontSize: 11, fontVariantNumeric: 'tabular-nums', padding: '1px 4px' },
  empty: { fontSize: 11, color: '#7A6850', padding: '6px', textAlign: 'center' },
  foot: { marginTop: 10, fontSize: 10, color: '#7A6850', borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'rgba(216,148,56,0.12)', paddingTop: 6 },
  unitIcon: { fontSize: 14, width: 20, textAlign: 'center' },
  unitMeta: { flex: 1, fontSize: 12, color: '#F5E6D0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  unitInc: { fontSize: 11, color: '#3F7A3D', fontVariantNumeric: 'tabular-nums' },
  unitPrice: { fontSize: 12, color: '#D89438', fontVariantNumeric: 'tabular-nums', minWidth: 50, textAlign: 'right' },
  symbolLegend: { display: 'flex', flexWrap: 'wrap', columnGap: 10, rowGap: 3, marginTop: 8, fontSize: 10, color: '#C7B299' },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 4 },
  legendGlyph: { display: 'inline-block', minWidth: 12, textAlign: 'center', fontFamily: 'serif', fontSize: 12, fontWeight: 'bold' },
  decreeRow: { display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 6px', borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'rgba(216,148,56,0.08)' },
  decreeStatus: { fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, minWidth: 56 },
  decreeSubject: { fontSize: 12, color: '#F5E6D0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  decreeMeta: { fontSize: 10, color: '#7A6850', marginLeft: 62 },

  // ── Market form + my-orders ───────────────────────────────────────
  formGrid: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 },
  sideToggle: { display: 'flex', gap: 4 },
  sideBtn: {
    flex: 1, padding: '6px 8px', fontSize: 11, fontWeight: 600,
    background: 'transparent', color: '#A89378',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(216,148,56,0.20)',
    borderRadius: 4, cursor: 'pointer',
  },
  sideBtnBuy: { background: '#1F3A1E', color: '#86efac', borderColor: '#22c55e' },
  sideBtnSell: { background: '#3A1F1F', color: '#fca5a5', borderColor: '#ef4444' },
  input: {
    width: '100%', padding: '6px 8px', fontSize: 12,
    background: 'rgba(245,230,208,0.05)', color: '#F5E6D0',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(216,148,56,0.20)',
    borderRadius: 4, outline: 'none',
    boxSizing: 'border-box', fontFamily: 'inherit',
  },
  select: {
    width: '100%', padding: '6px 8px', fontSize: 12,
    background: '#1F1812', color: '#F5E6D0',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(216,148,56,0.20)',
    borderRadius: 4, outline: 'none',
    boxSizing: 'border-box', fontFamily: 'inherit',
  },
  submit: {
    padding: '7px 10px', fontSize: 12, fontWeight: 600,
    background: '#3F7A3D', color: '#F5E6D0',
    border: 'none', borderRadius: 4, cursor: 'pointer',
  },
  formMsg: { fontSize: 10, color: '#A89378', marginTop: 2 },
  openOrderRow: {
    display: 'flex', gap: 6, alignItems: 'center',
    fontSize: 11, padding: '3px 4px',
    borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'rgba(216,148,56,0.08)',
  },
  cancelBtn: {
    marginLeft: 'auto', width: 22, height: 22, borderRadius: 11,
    background: 'rgba(239,68,68,0.15)', color: '#ef4444',
    border: 'none', cursor: 'pointer', fontSize: 11, lineHeight: 1,
  },

  // ── My Agents tab ─────────────────────────────────────────────────
  agentHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8,
  },
  agentCount: { fontSize: 11, color: '#A89378', fontFamily: 'Georgia, serif' },
  createBtn: {
    padding: '5px 10px', fontSize: 11, fontWeight: 600,
    background: '#5C6F8A', color: '#F5E6D0',
    border: 'none', borderRadius: 4, cursor: 'pointer',
  },
  emptyPad: { fontSize: 12, color: '#A89378', padding: '14px 8px', textAlign: 'center', lineHeight: 1.4 },
  errMsg: { fontSize: 11, color: '#fca5a5', padding: '6px 4px' },
  agentList: { display: 'flex', flexDirection: 'column', gap: 6 },
  agentCard: {
    padding: '8px 10px', borderRadius: 8,
    background: 'rgba(245,230,208,0.04)',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(216,148,56,0.12)',
    display: 'flex', flexDirection: 'column', gap: 4,
  },
  // External-agent green theme — visually distinct from the
  // brownish-yellow in-game default. Forest-green border + a faint
  // green tint + a green left rail via box-shadow.
  agentCardExternal: {
    background: 'rgba(63,122,61,0.12)',
    borderColor: 'rgba(159,216,154,0.55)',
    boxShadow: 'inset 3px 0 0 rgba(159,216,154,0.9), 0 2px 8px rgba(0,0,0,0.25)',
  },
  externalBadge: {
    marginLeft: 6,
    padding: '1px 5px',
    fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
    color: '#1F1812',
    background: '#9FD89A',
    borderRadius: 3,
    verticalAlign: 'middle',
  },
  agentSectionLabel: {
    fontSize: 10, fontWeight: 700,
    letterSpacing: 0.6, textTransform: 'uppercase' as const,
    color: '#F5E6D0',
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '2px 0',
  },
  agentSectionMeta: {
    fontSize: 9, color: '#7A6850', fontWeight: 500, letterSpacing: 0.3,
    marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' as const,
  },
  externalCTA: {
    padding: '10px 12px', borderRadius: 8,
    background: 'rgba(63,122,61,0.06)',
    borderWidth: 1, borderStyle: 'dashed' as const, borderColor: 'rgba(159,216,154,0.45)',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  externalCTAHead: { display: 'flex', alignItems: 'center', gap: 6 },
  externalCTAIcon: { fontSize: 16 },
  externalCTATitle: {
    fontSize: 12, fontWeight: 700,
    color: '#9FD89A',
    fontFamily: 'Georgia, serif',
    letterSpacing: 0.3,
  },
  externalCTABody: {
    fontSize: 11, color: '#A89378', lineHeight: 1.45,
  },
  externalCTACode: {
    background: 'rgba(0,0,0,0.4)',
    color: '#9FD89A',
    padding: '0 4px',
    borderRadius: 3,
    fontSize: 10,
    fontFamily: '"Courier New", monospace',
  },
  externalCTABtn: {
    alignSelf: 'flex-start' as const,
    padding: '6px 10px',
    fontSize: 11, fontWeight: 600, letterSpacing: 0.3,
    color: '#1F1812', background: '#9FD89A',
    border: 'none', borderRadius: 6,
    textDecoration: 'none',
    cursor: 'pointer',
  },
  agentCardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  agentName: { fontSize: 13, color: '#F5E6D0', fontWeight: 600, fontFamily: 'Georgia, serif' },
  agentBal: { fontSize: 12, color: '#D89438', fontVariantNumeric: 'tabular-nums' },
  agentMeta: { fontSize: 10, color: '#7A6850', display: 'flex', flexWrap: 'wrap', gap: 4 },
  roleSwitcher: {
    display: 'flex', alignItems: 'center', gap: 8,
    marginTop: 6, padding: '4px 6px',
    background: 'rgba(245,230,208,0.04)',
    borderRadius: 4,
  },
  roleLabel: { fontSize: 10, color: '#A89378', fontWeight: 600, letterSpacing: 0.5 },
  roleBtnRow: { display: 'flex', gap: 4, flex: 1 },
  roleBtn: {
    flex: 1, padding: '4px 6px', fontSize: 10, fontWeight: 600,
    background: 'rgba(245,230,208,0.06)', color: '#A89378',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(245,230,208,0.10)',
    borderRadius: 3, cursor: 'pointer',
  },
  roleBtnActive: {
    background: 'rgba(63,122,61,0.22)', color: '#F5E6D0',
    borderColor: '#3F7A3D', cursor: 'default',
  },

  // ── Revive button (shown when agent is dormant) ─────────────────
  reviveWrap: { marginTop: 6 },
  reviveBtn: {
    width: '100%', padding: '8px 12px',
    fontSize: 13, fontWeight: 700, letterSpacing: 0.3,
    background: '#B5563A', color: '#F5E6D0',
    borderWidth: 1, borderStyle: 'solid', borderColor: '#D89438',
    borderRadius: 6, cursor: 'pointer',
    boxShadow: '0 0 12px rgba(181,86,58,0.35)',
  },

  // ── Inventory app ─────────────────────────────────────────────────
  invHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 4px', marginBottom: 8,
    borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'rgba(245,230,208,0.10)',
  },
  invHeaderLabel: { fontSize: 11, color: '#A89378', letterSpacing: 0.5, textTransform: 'uppercase' },
  invHeaderValue: { fontSize: 14, color: '#D89438', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  invGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: 6,
  },
  invSlot: {
    aspectRatio: '1 / 1',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    gap: 2, padding: 4,
    background: 'rgba(245,230,208,0.04)',
    color: '#7A6850',
    borderWidth: 1, borderStyle: 'solid',
    borderRadius: 6,
    cursor: 'not-allowed',
    opacity: 0.5,
    fontFamily: 'inherit',
  },
  invSlotOwned: {
    background: 'rgba(245,230,208,0.08)',
    color: '#F5E6D0',
    cursor: 'pointer',
    opacity: 1,
  },
  invIcon: { fontSize: 22, lineHeight: 1 },
  invQty: { fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#D89438' },
  invName: { fontSize: 8, textAlign: 'center', lineHeight: 1.1, padding: '0 1px' },

  // ── Burn confirmation dialog ──────────────────────────────────────
  burnBackdrop: {
    position: 'absolute', inset: 0, zIndex: 50,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16,
  },
  burnPanel: {
    background: '#1F1812', color: '#F5E6D0',
    borderRadius: 10, padding: 16,
    width: '100%', maxWidth: 280,
    display: 'flex', flexDirection: 'column', gap: 8,
    boxShadow: '0 12px 40px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(216,148,56,0.18)',
  },
  burnHead: { display: 'flex', alignItems: 'center', gap: 8 },
  burnIcon: { fontSize: 28 },
  burnTitle: { fontSize: 15, fontWeight: 600, fontFamily: 'Georgia, serif' },
  burnMeta: { fontSize: 11, color: '#A89378' },
  burnRow: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 },
  burnLabel: { fontSize: 11, color: '#A89378', flex: 0 },
  maxBtn: {
    padding: '4px 8px', fontSize: 11, fontWeight: 600,
    background: 'rgba(245,230,208,0.08)', color: '#F5E6D0',
    border: 'none', borderRadius: 4, cursor: 'pointer',
  },
  burnGained: { fontSize: 12, color: '#D89438', fontWeight: 600 },
  burnActions: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 },
  agentActions: { display: 'flex', gap: 6, marginTop: 4 },
  fundBtn: {
    flex: 1, padding: '5px 8px', fontSize: 11, fontWeight: 600,
    background: '#3F7A3D', color: '#F5E6D0',
    border: 'none', borderRadius: 4, cursor: 'pointer',
  },
  reclaimBtn: {
    flex: 1, padding: '5px 8px', fontSize: 11, fontWeight: 600,
    background: 'rgba(216,148,56,0.18)', color: '#D89438',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(216,148,56,0.30)',
    borderRadius: 4, cursor: 'pointer',
  },
  dangerBtn: {
    flex: 1, padding: '5px 8px', fontSize: 11, fontWeight: 600,
    background: 'rgba(239,68,68,0.10)', color: '#fca5a5',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(239,68,68,0.30)',
    borderRadius: 4, cursor: 'pointer',
  },
  confirmDeleteRow: {
    display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6,
    padding: '8px 6px', borderRadius: 4,
    background: 'rgba(239,68,68,0.06)',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(239,68,68,0.20)',
  },
  confirmDeleteText: { fontSize: 11, color: '#F5E6D0', lineHeight: 1.4 },
  confirmDeleteActions: { display: 'flex', gap: 6, justifyContent: 'flex-end' },

  // ── Advanced disclosure (autopilot toggle + API key export) ─────────
  advancedRow: { marginTop: 4 },
  advancedToggle: {
    background: 'transparent', color: '#7A6850',
    border: 'none', cursor: 'pointer', fontSize: 10, padding: '2px 0',
  },
  advancedBody: {
    display: 'flex', flexDirection: 'column', gap: 4,
    marginTop: 4, padding: '6px 6px',
    borderRadius: 4,
    background: 'rgba(245,230,208,0.03)',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(216,148,56,0.10)',
  },
  advancedRowItem: { display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' },
  advancedLabel: { fontSize: 10, color: '#A89378' },
  advancedSmallBtn: {
    padding: '3px 8px', fontSize: 10, fontWeight: 600,
    background: 'rgba(216,148,56,0.18)', color: '#D89438',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(216,148,56,0.30)',
    borderRadius: 3, cursor: 'pointer',
  },
  allocateRow: {
    display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4, alignItems: 'center',
  },
  cancelTextBtn: {
    background: 'transparent', color: '#A89378',
    border: 'none', cursor: 'pointer', fontSize: 11, padding: '5px 8px',
  },

  // ── Modal (create agent / api key) ─────────────────────────────────
  modalScrim: {
    position: 'absolute', inset: 0, zIndex: 30,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16,
  },
  modal: {
    width: '100%', maxWidth: 280, background: '#2A1F18',
    borderRadius: 10, padding: 14,
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(216,148,56,0.30)',
    display: 'flex', flexDirection: 'column', gap: 8,
    boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
  },
  modalTitle: { fontSize: 13, fontWeight: 600, color: '#F5E6D0', fontFamily: 'Georgia, serif' },
  modalNote: { fontSize: 11, color: '#A89378', lineHeight: 1.4 },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 4 },
  apiKeyBox: {
    background: 'rgba(0,0,0,0.30)', padding: 8, borderRadius: 6,
    display: 'flex', flexDirection: 'column',
  },
  apiKeyLabel: { fontSize: 9, color: '#A89378', textTransform: 'uppercase', letterSpacing: 0.5 },
  apiKeyCode: {
    fontFamily: 'monospace', fontSize: 10, color: '#D89438',
    wordBreak: 'break-all', marginTop: 2,
  },

  // ── Job picker grid (create wizard, step 1) ──────────────────────────
  jobGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
    maxHeight: 280, overflowY: 'auto',
  },
  jobCard: {
    background: 'rgba(245,230,208,0.04)',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(216,148,56,0.18)',
    borderRadius: 6, padding: '8px 6px', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
    textAlign: 'left',
  },
  jobCardActive: {
    background: 'rgba(216,148,56,0.18)',
    borderColor: '#D89438',
  },
  jobIcon: { fontSize: 22 },
  jobLabel: { fontSize: 12, fontWeight: 600, color: '#F5E6D0', fontFamily: 'Georgia, serif' },
  jobSummary: { fontSize: 10, color: '#A89378', lineHeight: 1.3 },

  // ── Category picker (create wizard, step 2) ──────────────────────────
  // 2x2 grid of resource cards (Food/Materials/Energy/Luxury) above a
  // wide bottom button for Work-mode wages.
  categoryGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
  },
  categoryCard: {
    background: 'rgba(245,230,208,0.04)',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(216,148,56,0.18)',
    borderRadius: 8, padding: '14px 6px', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
    textAlign: 'center' as const,
  },
  categoryCardActive: {
    background: 'rgba(216,148,56,0.22)',
    borderColor: '#D89438',
    boxShadow: '0 0 12px rgba(216,148,56,0.25)',
  },
  categoryIcon: { fontSize: 30 },
  categoryIconInline: { fontSize: 18 },
  categoryLabel: { fontSize: 13, fontWeight: 600, color: '#F5E6D0', fontFamily: 'Georgia, serif' },
  // The bottom wide button is intentionally thinner + longer than the
  // 2x2 cards — owner direction 2026-05-20.
  categoryWideCard: {
    width: '100%',
    background: 'rgba(245,230,208,0.04)',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(216,148,56,0.18)',
    borderRadius: 8, padding: '8px 10px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 6,
  },
  categoryWideLabel: { fontSize: 13, fontWeight: 600, color: '#F5E6D0', fontFamily: 'Georgia, serif' },
  categoryHint: { fontSize: 11, color: '#A89378', fontStyle: 'italic', padding: '0 2px' },

  // ── Luxury item picker (create wizard, step 3 — luxury branch) ───────
  itemGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4,
    maxHeight: 280, overflowY: 'auto',
  },
  itemSlot: {
    background: 'rgba(245,230,208,0.04)',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(216,148,56,0.15)',
    borderRadius: 6, padding: '6px 4px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
    cursor: 'pointer',
  },
  itemSlotEnabled: { opacity: 1 },
  itemSlotDisabled: { opacity: 0.35, cursor: 'not-allowed' },
  itemSlotActive: {
    background: 'rgba(216,148,56,0.22)',
    borderColor: '#D89438',
  },
  itemSlotIcon: { fontSize: 22 },
  itemSlotLabel: { fontSize: 10, color: '#F5E6D0', fontWeight: 600, textAlign: 'center' as const, lineHeight: 1.2 },
  itemSlotMeta: { fontSize: 8, color: '#A89378', textTransform: 'uppercase' as const, letterSpacing: 0.3 },

  // ── Workplace step (parcel picker) ────────────────────────────────────
  parcelList: {
    display: 'flex', flexDirection: 'column', gap: 4,
    maxHeight: 220, overflowY: 'auto',
  },
  parcelOption: {
    background: 'rgba(245,230,208,0.04)',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(216,148,56,0.18)',
    borderRadius: 6, padding: '6px 8px', cursor: 'pointer', textAlign: 'left',
  },
  parcelOptionActive: {
    background: 'rgba(216,148,56,0.18)',
    borderColor: '#D89438',
  },
  parcelOptionTitle: { fontSize: 12, color: '#F5E6D0', fontWeight: 600 },
  parcelOptionMeta: { fontSize: 10, color: '#7A6850' },

  // ── Confirm step ──────────────────────────────────────────────────────
  confirmRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 4px',
  },
  confirmIcon: { fontSize: 36 },
  confirmName: { fontSize: 14, color: '#F5E6D0', fontWeight: 600, fontFamily: 'Georgia, serif' },
  confirmRole: { fontSize: 11, color: '#A89378' },
  confirmDetails: { fontSize: 11, color: '#A89378', lineHeight: 1.5, padding: '4px 0' },

  // ── Wallet tab ────────────────────────────────────────────────────
  walletWrap: {
    display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 4px',
  },
  walletStatus: {
    fontSize: 11, color: '#A89378', textTransform: 'uppercase', letterSpacing: 0.8,
    fontFamily: 'Georgia, serif',
  },
  walletAddr: {
    fontFamily: 'monospace', fontSize: 14, color: '#D89438',
    background: 'rgba(216,148,56,0.08)',
    padding: '8px 10px', borderRadius: 6, textAlign: 'center',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(216,148,56,0.20)',
  },
  walletHint: { fontSize: 11, color: '#A89378', lineHeight: 1.5 },
  walletPrimaryBtn: {
    padding: '10px 14px', fontSize: 13, fontWeight: 600,
    background: '#3F2A6E', color: '#F5E6D0',
    border: 'none', borderRadius: 6, cursor: 'pointer',
    marginTop: 4,
  },
  walletDangerBtn: {
    padding: '10px 14px', fontSize: 13, fontWeight: 600,
    background: 'rgba(239,68,68,0.10)', color: '#fca5a5',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(239,68,68,0.30)',
    borderRadius: 6, cursor: 'pointer',
    marginTop: 4,
  },

  // ── Rank app ──────────────────────────────────────────────────────
  rankWrap: { display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 2px' },
  rankErr: { padding: 12, fontSize: 12, color: '#fca5a5' },
  rankLoading: { padding: 12, fontSize: 12, color: '#A89378' },
  rankCard: {
    display: 'flex', alignItems: 'center', gap: 14,
    padding: 12,
    background: 'rgba(245,230,208,0.04)',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(216,148,56,0.15)',
    borderRadius: 10,
  },
  rankCrest: {
    width: 60, height: 60, borderRadius: 30,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 26, fontWeight: 900, fontFamily: 'Georgia, serif',
    textShadow: '0 1px 0 rgba(255,255,255,0.4)',
    flexShrink: 0,
  },
  rankCardRight: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 },
  rankLabel: { fontSize: 10, color: '#A89378', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 },
  rankTitle: { fontSize: 18, fontWeight: 700, color: '#F5E6D0', fontFamily: 'Georgia, serif' },
  rankLifetime: { fontSize: 11, color: '#A89378' },

  rankProgressSection: { display: 'flex', flexDirection: 'column', gap: 6 },
  rankProgressLabel: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontSize: 12, color: '#F5E6D0', fontVariantNumeric: 'tabular-nums',
  },
  rankProgressTrack: {
    position: 'relative',
    height: 10, width: '100%',
    background: 'rgba(0,0,0,0.4)',
    borderRadius: 5,
    overflow: 'hidden',
    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.6)',
  },
  rankProgressFill: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    borderRadius: 5,
    transition: 'width 0.3s ease',
  },
  rankProgressFooter: {
    display: 'flex', justifyContent: 'space-between',
    fontSize: 10, color: '#A89378', fontVariantNumeric: 'tabular-nums',
  },
  rankMaxedOut: {
    padding: '10px 12px',
    fontSize: 12, color: '#B9F2FF', textAlign: 'center',
    background: 'rgba(185,242,255,0.06)',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(185,242,255,0.2)',
    borderRadius: 8,
  },

  rankBenefitsSection: { display: 'flex', flexDirection: 'column', gap: 6 },
  rankBenefitsHeader: {
    fontSize: 10, color: '#A89378',
    textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600,
  },
  rankBenefitsGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6,
  },
  rankBenefitItem: {
    padding: '6px 8px',
    background: 'rgba(245,230,208,0.04)',
    borderRadius: 6,
  },
  rankBenefitValue: { fontSize: 16, color: '#F5E6D0', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  rankBenefitLabel: { fontSize: 9, color: '#A89378', textTransform: 'uppercase', letterSpacing: 0.4 },

  rankHint: {
    fontSize: 10, color: '#7A6850', lineHeight: 1.4,
    fontStyle: 'italic', padding: '0 2px',
  },
};
