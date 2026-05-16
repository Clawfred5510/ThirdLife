import React, { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, apiDelete, hasAuthToken } from '../../network/api';
import {
  hasInjectedWallet,
  getStoredPlayerId,
  getStoredAuthToken,
  connectWallet,
  logoutWallet,
} from '../../network/wallet';
import {
  RESOURCE_TYPES, ResourceType,
  GRID_COLS, GRID_ROWS, ZONE_COLORS, LANDMARKS,
  zoneForGrid, isPremiumParcel,
  AGENT_PERSONALITIES, AGENT_STRATEGIES,
  AgentPersonality, AgentStrategy,
  JOBS, JOB_IDS, JobId,
} from '@gamestu/shared';

type AppId =
  | 'leaderboard' | 'market' | 'events' | 'properties' | 'world2d' | 'governance'
  | 'agents' | 'closet' | 'wallet';
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
  { id: 'agents',      label: 'My Agents',   icon: '🤖', color: '#5C6F8A' }, // slate-blue
  { id: 'closet',      label: 'Closet',      icon: '👕', color: '#A8556B' }, // dusty rose
  { id: 'market',      label: 'Market',      icon: '📈', color: '#3F7A3D' }, // forest
  { id: 'leaderboard', label: 'Leaderboard', icon: '🏆', color: '#D89438' }, // ochre
  { id: 'properties',  label: 'Properties',  icon: '🏢', color: '#B5563A' }, // brick
  { id: 'world2d',     label: 'Map',         icon: '🗺️', color: '#2A5560' }, // teal
  { id: 'governance',  label: 'Decrees',     icon: '🗳️', color: '#7A4F2E' }, // wood
  { id: 'events',      label: 'Events',      icon: '📜', color: '#D8C4A0' }, // sandstone
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
    case 'buy_land':    return `bought parcel #${data.parcel}`;
    case 'claim_and_build':
    case 'build':       return `built ${data.building} on parcel #${data.parcel}`;
    case 'transfer':    return `sent ${data.amount} to ${data.to} (fee ${data.fee ?? 0})`;
    case 'agent_registered': return `registered: ${data.name}`;
    case 'chat':        return `→ ${data.to}: ${String(data.message ?? '').slice(0, 40)}`;
    case 'explore':     return `explored parcel #${data.parcel}`;
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
        {app.id === 'properties' && <PropertiesBody />}
        {app.id === 'world2d' && <World2DBody />}
        {app.id === 'governance' && <GovernanceBody />}
        {app.id === 'events' && <EventBody />}
        {app.id === 'agents' && <AgentsBody />}
        {app.id === 'wallet' && <WalletBody />}
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
  balance: number;
  resources: { food: number; materials: number; energy: number; luxury: number };
  land_count: number;
  building_count: number;
  autopilot_enabled: boolean;
  created_at: string;
}

interface AgentsMine { wallet: string; agents: AgentRow[]; limit: number; }

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
  const [revealedKey, setRevealedKey] = useState<{ id: string; api_key: string } | null>(null);
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

  return (
    <>
      <div style={S.agentHeader}>
        <span style={S.agentCount}>
          {data ? `${data.agents.length}/${data.limit}` : '…'} agents
        </span>
        <button
          onClick={() => setShowCreate(true)}
          disabled={!!data && data.agents.length >= data.limit}
          style={S.createBtn}
        >
          + New agent
        </button>
      </div>
      {err && <div style={S.errMsg}>{err}</div>}
      {data && data.agents.length === 0 && (
        <div style={S.emptyPad}>
          You have no agents yet. Create one — each agent is an autonomous economic actor you fund and direct.
        </div>
      )}
      <div style={S.agentList}>
        {data?.agents.map((a) => (
          <AgentCard key={a.id} agent={a} onChange={refresh} />
        ))}
      </div>
      {showCreate && (
        <CreateAgentModal
          onClose={() => setShowCreate(false)}
          onCreated={(payload) => {
            setShowCreate(false);
            setRevealedKey({ id: payload.id, api_key: payload.api_key });
            refresh();
          }}
        />
      )}
      {revealedKey && (
        <ApiKeyModal
          agentId={revealedKey.id}
          apiKey={revealedKey.api_key}
          onClose={() => setRevealedKey(null)}
        />
      )}
    </>
  );
};

const AgentCard: React.FC<{ agent: AgentRow; onChange: () => void }> = ({ agent, onChange }) => {
  const [mode, setMode] = useState<'idle' | 'fund' | 'reclaim' | 'reassign' | 'confirm_delete'>('idle');
  const [amt, setAmt] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    const n = parseInt(amt, 10);
    if (!Number.isFinite(n) || n <= 0) { setErr('Enter a positive integer.'); return; }
    setBusy(true);
    try {
      const endpoint = mode === 'fund' ? 'allocate' : 'reclaim';
      await apiPost(`/agents/${agent.id}/${endpoint}`, { amount: n }, { authed: true });
      setAmt(''); setMode('idle'); onChange();
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
    <div style={S.agentCard}>
      <div style={S.agentCardHead}>
        <span style={S.agentName}>
          <span style={{ marginRight: 4 }}>{jobIcon}</span>{agent.name}
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
      </div>
      {mode === 'idle' && (
        <div style={S.agentActions}>
          <button onClick={() => setMode('fund')} style={S.fundBtn}>Fund</button>
          <button
            onClick={() => setMode('reclaim')}
            disabled={agent.balance <= 0}
            style={S.reclaimBtn}
          >
            Reclaim
          </button>
          {reqBuilding && (
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
      {(mode === 'fund' || mode === 'reclaim') && (
        <div style={S.allocateRow}>
          <input
            type="number" min={1} step={1} value={amt}
            onChange={(e) => setAmt(e.target.value)}
            placeholder={mode === 'fund' ? 'Amount to send' : 'Amount to pull back'}
            style={S.input}
            autoFocus
          />
          <button onClick={submit} disabled={busy} style={S.submit}>
            {busy ? '...' : mode === 'fund' ? 'Send' : 'Pull'}
          </button>
          <button
            onClick={() => { setMode('idle'); setAmt(''); setErr(null); }}
            style={S.cancelTextBtn}
          >
            cancel
          </button>
          {err && <div style={S.formMsg}>{err}</div>}
        </div>
      )}
      {mode === 'reassign' && reqBuilding && (
        <ReassignPicker
          agent={agent}
          requiredBuilding={reqBuilding}
          onCancel={() => setMode('idle')}
          onDone={() => { setMode('idle'); onChange(); }}
        />
      )}
    </div>
  );
};

const ReassignPicker: React.FC<{
  agent: AgentRow;
  requiredBuilding: string;
  onCancel: () => void;
  onDone: () => void;
}> = ({ agent, requiredBuilding, onCancel, onDone }) => {
  const [owned, setOwned] = useState<WorldParcel[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const myWallet = (() => { try { return localStorage.getItem('tl_player_id'); } catch { return null; } })();

  useEffect(() => {
    apiGet<WorldResp>('/world')
      .then((r) => {
        const mine = r.parcels_data.filter(
          (p) => p.owner_id === myWallet && p.business_type === requiredBuilding,
        );
        setOwned(mine);
      })
      .catch((e) => setErr((e as Error).message));
  }, [myWallet, requiredBuilding]);

  const reassign = async (parcelId: number) => {
    setBusy(true); setErr(null);
    try {
      await apiPost(`/agents/${agent.id}/reassign`, { workplace_parcel_id: parcelId }, { authed: true });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={S.allocateRow}>
      {!owned && <span style={S.formMsg}>Loading owned {requiredBuilding}s…</span>}
      {owned && owned.length === 0 && (
        <span style={S.formMsg}>
          You don't own a {requiredBuilding}. Build one first, then reassign.
        </span>
      )}
      {owned && owned.length > 0 && (
        <select
          disabled={busy}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (Number.isFinite(v)) reassign(v);
          }}
          style={S.select}
          defaultValue=""
        >
          <option value="" disabled>Pick a {requiredBuilding}…</option>
          {owned.map((p) => (
            <option key={p.id} value={p.id}>
              #{p.id} — {p.business_name || requiredBuilding} ({p.grid_x},{p.grid_y})
            </option>
          ))}
        </select>
      )}
      <button onClick={onCancel} style={S.cancelTextBtn}>cancel</button>
      {err && <div style={S.formMsg}>{err}</div>}
    </div>
  );
};

// ── Create-agent four-step wizard ──────────────────────────────────────
// Step 1: Job picker (8 cards)
// Step 2: Workplace picker (only for jobs that need one)
// Step 3: Name + initial fund
// Step 4: Confirm + spawn

type CreateStep = 'job' | 'workplace' | 'name' | 'confirm';

const CreateAgentModal: React.FC<{
  onClose: () => void;
  onCreated: (payload: { id: string; api_key: string }) => void;
}> = ({ onClose, onCreated }) => {
  const [step, setStep] = useState<CreateStep>('job');
  const [job, setJob] = useState<JobId | null>(null);
  const [workplaceId, setWorkplaceId] = useState<number | null>(null);
  const [workplaceLabel, setWorkplaceLabel] = useState<string>('');
  const [name, setName] = useState('');
  const [initialFund, setInitialFund] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const jobSpec = job ? JOBS[job] : null;
  const needsWorkplace = !!jobSpec?.requires_building;

  const advanceFromJob = () => {
    if (!job) return;
    setStep(needsWorkplace ? 'workplace' : 'name');
  };

  const submit = async () => {
    if (!job) return;
    setErr(null);
    if (!name.trim()) { setErr('Name required.'); return; }
    setBusy(true);
    try {
      const fund = parseInt(initialFund, 10);
      const body: Record<string, unknown> = { name: name.trim(), job };
      if (workplaceId !== null) body.workplace_parcel_id = workplaceId;
      if (Number.isFinite(fund) && fund > 0) body.initial_fund = fund;

      const created = await apiPost<{ ok: boolean; agent: { id: string }; api_key: string; initial_fund_error?: string }>(
        '/agents/register', body, { authed: true },
      );
      if (created.initial_fund_error) {
        setErr(`Agent created, but initial fund failed: ${created.initial_fund_error}`);
      }
      onCreated({ id: created.agent.id, api_key: created.api_key });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={S.modalScrim} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalTitle}>
          New agent — step {step === 'job' ? '1' : step === 'workplace' ? '2' : step === 'name' ? '3' : '4'} of {needsWorkplace ? 4 : 3}
        </div>

        {step === 'job' && (
          <>
            <div style={S.modalNote}>Pick a role. Each job determines what your agent does and where it stands.</div>
            <div style={S.jobGrid}>
              {JOB_IDS.map((id) => (
                <button
                  key={id}
                  onClick={() => setJob(id)}
                  style={{ ...S.jobCard, ...(job === id ? S.jobCardActive : {}) }}
                >
                  <div style={S.jobIcon}>{JOBS[id].icon}</div>
                  <div style={S.jobLabel}>{JOBS[id].label}</div>
                  <div style={S.jobSummary}>{JOBS[id].summary}</div>
                </button>
              ))}
            </div>
            <div style={S.modalActions}>
              <button onClick={onClose} style={S.cancelTextBtn}>cancel</button>
              <button onClick={advanceFromJob} disabled={!job} style={S.submit}>Next</button>
            </div>
          </>
        )}

        {step === 'workplace' && jobSpec && (
          <WorkplaceStep
            requiredBuilding={jobSpec.requires_building!}
            jobLabel={jobSpec.label}
            selected={workplaceId}
            onPick={(id, label) => { setWorkplaceId(id); setWorkplaceLabel(label); }}
            onBack={() => setStep('job')}
            onContinue={() => setStep('name')}
            onCancel={onClose}
          />
        )}

        {step === 'name' && (
          <>
            <div style={S.modalNote}>Name your agent and optionally fund it now.</div>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Name (unique)" maxLength={32}
              style={S.input} autoFocus
            />
            <input
              type="number" min={0} step={1} value={initialFund}
              onChange={(e) => setInitialFund(e.target.value)}
              placeholder="Initial $AMETA (optional)"
              style={S.input}
            />
            <div style={S.modalActions}>
              <button
                onClick={() => setStep(needsWorkplace ? 'workplace' : 'job')}
                style={S.cancelTextBtn}
              >
                back
              </button>
              <button
                onClick={() => setStep('confirm')}
                disabled={!name.trim()}
                style={S.submit}
              >
                Next
              </button>
            </div>
          </>
        )}

        {step === 'confirm' && jobSpec && (
          <>
            <div style={S.confirmRow}>
              <span style={S.confirmIcon}>{jobSpec.icon}</span>
              <div>
                <div style={S.confirmName}>{name}</div>
                <div style={S.confirmRole}>{jobSpec.label}</div>
              </div>
            </div>
            <div style={S.confirmDetails}>
              <div>Workplace: {workplaceId !== null ? workplaceLabel : (needsWorkplace ? 'auto-assigned (any open)' : 'roams')}</div>
              <div>Initial funding: {initialFund && parseInt(initialFund, 10) > 0 ? `${parseInt(initialFund, 10).toLocaleString()} $AMETA` : 'none — fund later'}</div>
            </div>
            {err && <div style={S.errMsg}>{err}</div>}
            <div style={S.modalActions}>
              <button onClick={() => setStep('name')} style={S.cancelTextBtn}>back</button>
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

const WorkplaceStep: React.FC<{
  requiredBuilding: string;
  jobLabel: string;
  selected: number | null;
  onPick: (parcelId: number, label: string) => void;
  onBack: () => void;
  onContinue: () => void;
  onCancel: () => void;
}> = ({ requiredBuilding, jobLabel, selected, onPick, onBack, onContinue, onCancel }) => {
  const [owned, setOwned] = useState<WorldParcel[] | null>(null);
  const [foreignCount, setForeignCount] = useState<number>(0);
  const myWallet = (() => { try { return localStorage.getItem('tl_player_id'); } catch { return null; } })();

  useEffect(() => {
    apiGet<WorldResp>('/world')
      .then((r) => {
        const matching = r.parcels_data.filter((p) => p.business_type === requiredBuilding);
        const mine = matching.filter((p) => p.owner_id === myWallet);
        const foreign = matching.filter((p) => p.owner_id !== myWallet);
        setOwned(mine);
        setForeignCount(foreign.length);
      })
      .catch(() => { setOwned([]); });
  }, [myWallet, requiredBuilding]);

  return (
    <>
      <div style={S.modalNote}>Pick where your {jobLabel} will work.</div>
      {!owned && <div style={S.formMsg}>Loading owned {requiredBuilding}s…</div>}
      {owned && owned.length === 0 && (
        <div style={S.modalNote}>
          You don't own a {requiredBuilding}. Your agent will work at one of the {foreignCount}
          {' '}existing {requiredBuilding}{foreignCount === 1 ? '' : 's'} owned by other players.
          You'll still earn the resources your agent produces; the parcel owner keeps their building income.
        </div>
      )}
      {owned && owned.length > 0 && (
        <div style={S.parcelList}>
          {owned.map((p) => (
            <button
              key={p.id}
              onClick={() => onPick(p.id, `#${p.id} — ${p.business_name || requiredBuilding}`)}
              style={{ ...S.parcelOption, ...(selected === p.id ? S.parcelOptionActive : {}) }}
            >
              <div style={S.parcelOptionTitle}>#{p.id} — {p.business_name || requiredBuilding}</div>
              <div style={S.parcelOptionMeta}>grid ({p.grid_x}, {p.grid_y})</div>
            </button>
          ))}
        </div>
      )}
      <div style={S.modalActions}>
        <button onClick={onCancel} style={S.cancelTextBtn}>cancel</button>
        <button onClick={onBack} style={S.cancelTextBtn}>back</button>
        <button onClick={onContinue} style={S.submit}>
          {owned && owned.length > 0 && selected === null
            ? 'Skip — auto-pick'
            : 'Next'}
        </button>
      </div>
    </>
  );
};

const ApiKeyModal: React.FC<{ agentId: string; apiKey: string; onClose: () => void }> = ({ agentId, apiKey, onClose }) => (
  <div style={S.modalScrim} onClick={onClose}>
    <div style={S.modal} onClick={(e) => e.stopPropagation()}>
      <div style={S.modalTitle}>API key — save it now</div>
      <div style={S.modalNote}>
        Give this key to a script to let it drive your agent via REST. It is shown only once.
      </div>
      <div style={S.apiKeyBox}>
        <div style={S.apiKeyLabel}>agent id</div>
        <code style={S.apiKeyCode}>{agentId}</code>
        <div style={{ ...S.apiKeyLabel, marginTop: 10 }}>api key</div>
        <code style={S.apiKeyCode}>{apiKey}</code>
      </div>
      <div style={S.modalActions}>
        <button
          onClick={() => { navigator.clipboard?.writeText(apiKey).catch(() => {}); }}
          style={S.submit}
        >
          Copy key
        </button>
        <button onClick={onClose} style={S.cancelTextBtn}>done</button>
      </div>
    </div>
  </div>
);

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

const UNIT_ICON: Record<PropertyRow['unit_type'], string> = {
  studio: '🏠', office: '🏢', penthouse: '👑',
};

const PropertiesBody: React.FC = () => {
  const [filter, setFilter] = useState<PropertyFilter>('for_sale');
  const [props, setProps] = useState<PropertyRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const url = filter === 'for_sale' ? '/properties?for_sale=true' : '/properties';
      apiGet<{ properties: PropertyRow[] }>(url)
        .then((r) => { if (!cancelled) setProps(r.properties); })
        .catch(() => {});
    };
    load();
    const i = setInterval(load, 6000);
    return () => { cancelled = true; clearInterval(i); };
  }, [filter]);

  return (
    <>
      <div style={S.tabRow}>
        <button onClick={() => setFilter('for_sale')} style={{ ...S.tab, ...(filter === 'for_sale' ? S.tabActive : {}) }}>
          For sale
        </button>
        <button onClick={() => setFilter('all')} style={{ ...S.tab, ...(filter === 'all' ? S.tabActive : {}) }}>
          Recent
        </button>
      </div>
      <div style={S.list}>
        {props.length === 0 ? (
          <div style={S.empty}>{filter === 'for_sale' ? 'No units listed' : 'No units yet'}</div>
        ) : (
          props.slice(0, 60).map((p) => (
            <div key={p.id} style={S.row}>
              <span style={S.unitIcon}>{UNIT_ICON[p.unit_type]}</span>
              <span style={S.unitMeta}>
                {p.unit_type} · F{p.floor}#{p.unit_index} · parcel {p.parcel_id}
              </span>
              <span style={S.unitInc}>+{p.income_per_tick}/t</span>
              {p.list_price !== null && (
                <span style={S.unitPrice}>{formatAmeta(p.list_price)}</span>
              )}
            </div>
          ))
        )}
      </div>
      <div style={S.foot}>
        Buy / list / unlist via <code>POST /api/v1/actions/buy-property</code> (etc).
      </div>
    </>
  );
};

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

    ctx.fillStyle = '#0c0e18';
    ctx.fillRect(0, 0, W, H);

    // Zone tints
    ctx.globalAlpha = 0.35;
    for (let gx = 0; gx < GRID_COLS; gx++) {
      for (let gy = 0; gy < GRID_ROWS; gy++) {
        ctx.fillStyle = ZONE_COLORS[zoneForGrid(gx, gy)];
        ctx.fillRect(gx * cellW, gy * cellH, cellW, cellH);
      }
    }
    ctx.globalAlpha = 1;

    // Premium gold borders
    ctx.strokeStyle = '#FFD24A';
    ctx.lineWidth = 1;
    for (let gx = 0; gx < GRID_COLS; gx++) {
      for (let gy = 0; gy < GRID_ROWS; gy++) {
        if (!isPremiumParcel(gx * GRID_COLS + gy)) continue;
        ctx.strokeRect(gx * cellW + 0.5, gy * cellH + 0.5, cellW - 1, cellH - 1);
      }
    }

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
      <div style={S.zoneLegend}>
        {(Object.keys(ZONE_COLORS) as Array<keyof typeof ZONE_COLORS>).map((z) => (
          <span key={z} style={S.legendItem}>
            <span style={{ ...S.legendSwatch, background: ZONE_COLORS[z] }} />
            {z}
          </span>
        ))}
      </div>
    </>
  );
};

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
  zoneLegend: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8, fontSize: 9, color: '#A89378' },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 3, textTransform: 'capitalize' },
  legendSwatch: { display: 'inline-block', width: 8, height: 8, borderRadius: 2 },
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
  agentCardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  agentName: { fontSize: 13, color: '#F5E6D0', fontWeight: 600, fontFamily: 'Georgia, serif' },
  agentBal: { fontSize: 12, color: '#D89438', fontVariantNumeric: 'tabular-nums' },
  agentMeta: { fontSize: 10, color: '#7A6850', display: 'flex', flexWrap: 'wrap', gap: 4 },
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
};
