import React, { useEffect, useState } from 'react';
import { apiGet } from '../../network/api';
import { RESOURCE_TYPES, ResourceType } from '@gamestu/shared';

type ActivePanel = 'leaderboard' | 'market' | 'events' | null;

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

const SORT_LABEL: Record<LeaderboardSort, string> = {
  net_worth: 'Net Worth', balance: 'Balance', land: 'Land',
  properties: 'Properties', reputation: 'Rep',
};
const SEVERITY_LABEL: Record<Severity, string> = {
  all: 'All', epic: 'Epic', major: 'Major', normal: 'Normal', minor: 'Minor',
};
const SEVERITY_COLOR: Record<string, string> = {
  epic: '#a855f7', major: '#22c55e', normal: '#e4e4ef', minor: '#8b8b9a',
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

// ── TopBar root ───────────────────────────────────────────────────────

export const TopBar: React.FC = () => {
  const [active, setActive] = useState<ActivePanel>(null);
  const toggle = (p: ActivePanel) => setActive((cur) => (cur === p ? null : p));

  return (
    <div style={S.dock}>
      <div style={S.btnRow}>
        <DockButton label="🏆 Leaderboard" active={active === 'leaderboard'} onClick={() => toggle('leaderboard')} aria="Toggle leaderboard" />
        <DockButton label="📈 Market" active={active === 'market'} onClick={() => toggle('market')} aria="Toggle market" />
        <DockButton label="📜 Events" active={active === 'events'} onClick={() => toggle('events')} aria="Toggle event log" />
      </div>
      {active && (
        <div style={S.panel} role="dialog" aria-label={active}>
          {active === 'leaderboard' && <LeaderboardBody />}
          {active === 'market' && <MarketBody />}
          {active === 'events' && <EventBody />}
        </div>
      )}
    </div>
  );
};

const DockButton: React.FC<{ label: string; active: boolean; onClick: () => void; aria: string }> = ({ label, active, onClick, aria }) => (
  <button
    style={{ ...S.btn, ...(active ? S.btnActive : {}) }}
    onClick={onClick}
    aria-label={aria}
    aria-pressed={active}
  >
    {label}
  </button>
);

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

const S: Record<string, React.CSSProperties> = {
  dock: {
    position: 'absolute', top: 60, right: 16, pointerEvents: 'auto',
    zIndex: 11, fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column',
    alignItems: 'flex-end', gap: 6,
  },
  btnRow: { display: 'flex', gap: 6 },
  btn: {
    background: 'rgba(12,14,24,0.85)', color: '#e4e4ef',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.12)', borderRadius: 8,
    padding: '6px 12px', fontSize: 13, cursor: 'pointer',
  },
  btnActive: { background: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.2)' },
  panel: {
    width: 340, background: 'rgba(12,14,24,0.92)', color: '#e4e4ef',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: 10,
  },
  tabRow: { display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' },
  tab: {
    flex: '1 1 auto', minWidth: 50, fontSize: 11, padding: '4px 6px',
    background: 'transparent', color: '#8b8b9a',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.08)', borderRadius: 6, cursor: 'pointer',
    textTransform: 'capitalize' as const,
  },
  tabActive: { color: '#e4e4ef', background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.2)' },
  list: { display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 320, overflowY: 'auto' },
  row: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '2px 4px' },
  rank: { width: 24, color: '#8b8b9a', fontVariantNumeric: 'tabular-nums' },
  name: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  valueG: { fontVariantNumeric: 'tabular-nums', color: '#22c55e' },
  badge: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  text: { color: '#e4e4ef', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cols: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 },
  colHeader: { fontSize: 11, color: '#8b8b9a', marginTop: 4, marginBottom: 4 },
  level: { display: 'flex', justifyContent: 'space-between', fontSize: 12, fontVariantNumeric: 'tabular-nums', padding: '2px 4px' },
  trades: { display: 'flex', flexDirection: 'column', gap: 2 },
  trade: { fontSize: 11, fontVariantNumeric: 'tabular-nums', padding: '1px 4px' },
  empty: { fontSize: 11, color: '#5b5b6a', padding: '6px', textAlign: 'center' },
  foot: { marginTop: 10, fontSize: 10, color: '#5b5b6a', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 6 },
};
