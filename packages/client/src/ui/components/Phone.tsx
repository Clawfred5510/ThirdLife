import React, { useEffect, useRef, useState } from 'react';
import { apiGet } from '../../network/api';
import {
  RESOURCE_TYPES, ResourceType,
  GRID_COLS, GRID_ROWS, ZONE_COLORS, LANDMARKS,
  zoneForGrid, isPremiumParcel,
} from '@gamestu/shared';

type AppId = 'leaderboard' | 'market' | 'events' | 'properties' | 'world2d' | 'governance';
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
  { id: 'leaderboard', label: 'Leaderboard', icon: '🏆', color: '#D89438' }, // ochre
  { id: 'market',      label: 'Market',      icon: '📈', color: '#3F7A3D' }, // forest
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
                <HomeScreen onLaunch={(id) => setActiveApp(id)} />
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

const MarketBody: React.FC = () => {
  const [resource, setResource] = useState<ResourceType>('food');
  const [book, setBook] = useState<BookSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiGet<BookSnapshot>(`/market/book/${resource}`)
        .then((r) => { if (!cancelled) setBook(r); })
        .catch(() => {});
    load();
    const i = setInterval(load, 4000);
    return () => { cancelled = true; clearInterval(i); };
  }, [resource]);

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
      <div style={S.foot}>Place orders via <code>POST /api/v1/market/order</code>.</div>
    </>
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
};
