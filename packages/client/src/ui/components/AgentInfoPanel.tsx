import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, hasAuthToken } from '../../network/api';

/**
 * 3D-world popup: shows when the player clicks an agent's avatar.
 *
 * Listens to `tl-agent-clicked` (fired from MainScene's avatar click
 * handler) for the agent id, then fetches /agents/:id/stats for live
 * task/balance/lifetime info. If the agent is dormant AND owned by the
 * current wallet, surfaces a big red Revive CTA.
 *
 * ESC closes. Clicking outside the panel closes.
 */

interface StatsCard {
  id: string;
  name: string;
  balance: number;
  net_worth: number;
  parcels: number;
  resources: { food: number; materials: number; energy: number; luxury: number };
  agent: {
    role: string;
    is_external: boolean;
    workplace_parcel_id: number | null;
    owner_wallet: string | null;
    dormant: boolean;
    starvation_ticks: number;
    lifetime: {
      wages: number;
      resources: Record<string, number>;
      items: Record<string, number>;
    };
  } | null;
}

type ConnectedAgent = { agentId: string; name: string };

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.floor(n));
}

export const AgentInfoPanel: React.FC = () => {
  const [target, setTarget] = useState<ConnectedAgent | null>(null);
  const [stats, setStats] = useState<StatsCard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Custom event from MainScene avatar click.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ConnectedAgent>).detail;
      if (!detail?.agentId) return;
      setTarget(detail);
      setStats(null);
      setErr(null);
    };
    window.addEventListener('tl-agent-clicked', handler);
    return () => window.removeEventListener('tl-agent-clicked', handler);
  }, []);

  // Fetch stats whenever target changes.
  const refresh = useCallback(async () => {
    if (!target) return;
    try {
      const r = await apiGet<StatsCard>(`/agents/${encodeURIComponent(target.agentId)}/stats`);
      setStats(r);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [target]);

  useEffect(() => {
    if (!target) return;
    refresh();
    const i = setInterval(refresh, 5000);
    return () => clearInterval(i);
  }, [target, refresh]);

  // ESC closes.
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTarget(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target]);

  const close = () => { setTarget(null); setStats(null); setErr(null); };

  const revive = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await apiPost(`/agents/${encodeURIComponent(target.agentId)}/revive`, {}, { authed: true });
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!target) return null;
  const a = stats?.agent;
  const ownsAgent = hasAuthToken() && a?.owner_wallet != null;
  const lifetime = a?.lifetime ?? { wages: 0, resources: {}, items: {} };
  const itemTotal = Object.values(lifetime.items).reduce((s, v) => s + (v as number), 0);

  let taskLine: string;
  if (!a) taskLine = 'loading…';
  else if (a.is_external) taskLine = 'External marketplace agent';
  else if (a.dormant) taskLine = `Dormant — ${a.starvation_ticks} ticks starved`;
  else if (a.workplace_parcel_id == null) taskLine = 'Idle — no workplace assigned';
  else taskLine = `${a.role.toUpperCase()} at parcel #${a.workplace_parcel_id}`;

  return (
    <div style={S.backdrop} onClick={close} role="dialog" aria-label={`Agent ${target.name}`}>
      <div style={S.panel} onClick={(e) => e.stopPropagation()}>
        <div style={S.header}>
          <div>
            <div style={S.name}>🤖 {stats?.name ?? target.name}</div>
            <div style={S.task}>{taskLine}</div>
          </div>
          <button onClick={close} style={S.closeBtn} aria-label="Close">✕</button>
        </div>

        {a?.dormant && ownsAgent && (
          <button onClick={revive} disabled={busy} style={S.reviveBtn}>
            {busy ? '…' : 'Revive for 100 🌾'}
          </button>
        )}

        <div style={S.section}>
          <div style={S.sectionLabel}>Current</div>
          <div style={S.statGrid}>
            <Stat label="Balance" value={`${fmt(stats?.balance ?? 0)} $AMETA`} />
            <Stat label="Net worth" value={fmt(stats?.net_worth ?? 0)} />
            <Stat label="Parcels" value={String(stats?.parcels ?? 0)} />
            <Stat label="Role" value={a?.role ?? '—'} />
          </div>
        </div>

        <div style={S.section}>
          <div style={S.sectionLabel}>Lifetime</div>
          <div style={S.statGrid}>
            <Stat label="Wages earned" value={`${fmt(lifetime.wages)} $AMETA`} />
            <Stat label="Items crafted" value={String(itemTotal)} />
            <Stat
              label="Food produced"
              value={fmt(lifetime.resources?.food ?? 0)}
            />
            <Stat
              label="Materials produced"
              value={fmt(lifetime.resources?.materials ?? 0)}
            />
            <Stat
              label="Energy produced"
              value={fmt(lifetime.resources?.energy ?? 0)}
            />
            <Stat label="Status" value={a?.is_external ? 'External' : a?.dormant ? 'Dormant' : 'Active'} />
          </div>
        </div>

        {err && <div style={S.err}>{err}</div>}
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={S.stat}>
    <div style={S.statLabel}>{label}</div>
    <div style={S.statValue}>{value}</div>
  </div>
);

const S: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'absolute', inset: 0, zIndex: 60,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'auto', fontFamily: 'sans-serif',
  },
  panel: {
    background: '#1F1812', color: '#F5E6D0',
    width: 'min(420px, calc(100vw - 32px))',
    padding: 18, borderRadius: 12,
    boxShadow: '0 12px 48px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(216,148,56,0.2)',
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  name: { fontSize: 18, fontWeight: 700, fontFamily: 'Georgia, serif' },
  task: { fontSize: 12, color: '#A89378', marginTop: 4 },
  closeBtn: {
    width: 28, height: 28, borderRadius: 14,
    background: 'rgba(245,230,208,0.08)', color: '#F5E6D0',
    border: 'none', cursor: 'pointer', fontSize: 14,
  },
  reviveBtn: {
    width: '100%', padding: '10px 16px',
    fontSize: 14, fontWeight: 700, letterSpacing: 0.4,
    background: '#B5563A', color: '#F5E6D0',
    borderWidth: 1, borderStyle: 'solid', borderColor: '#D89438',
    borderRadius: 8, cursor: 'pointer',
    boxShadow: '0 0 18px rgba(181,86,58,0.45)',
  },
  section: { display: 'flex', flexDirection: 'column', gap: 6 },
  sectionLabel: {
    fontSize: 10, color: '#A89378',
    letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 600,
  },
  statGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6,
  },
  stat: {
    background: 'rgba(245,230,208,0.05)',
    padding: '6px 8px',
    borderRadius: 6,
  },
  statLabel: { fontSize: 10, color: '#A89378' },
  statValue: { fontSize: 13, color: '#F5E6D0', fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  err: { color: '#fca5a5', fontSize: 11 },
};
