import React, { useCallback, useEffect, useState } from 'react';
import { PlayerResources } from '@gamestu/shared';
import { apiGet, hasAuthToken } from '../../network/api';
import { onRankUp } from '../../network/Client';

const ICONS: Record<string, string> = { food: '🌾', materials: '⛏️', energy: '⚡', luxury: '💎' };

const TIER_COLOR: Record<string, string> = {
  bronze:   '#CD7F32',
  silver:   '#C0C0C0',
  gold:     '#FFD700',
  platinum: '#E5E4E2',
  diamond:  '#B9F2FF',
};
const TIER_LABEL: Record<string, string> = {
  bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', diamond: 'Diamond',
};

interface RankSnapshot {
  lifetime: number;
  rank: string | null;
  next_rank: string | null;
  prev_threshold: number;
  next_threshold: number | null;
  progress: number;
}

export const ResourceBar: React.FC = () => {
  const [resources, setResources] = useState<PlayerResources>({ food: 0, materials: 0, energy: 0, luxury: 0 });
  const [rank, setRank] = useState<RankSnapshot | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) setResources(detail);
    };
    window.addEventListener('resource-update', handler);
    return () => window.removeEventListener('resource-update', handler);
  }, []);

  const refreshRank = useCallback(async () => {
    if (!hasAuthToken()) {
      setRank(null);
      return;
    }
    try {
      const r = await apiGet<RankSnapshot>('/wallet/rank', { authed: true });
      setRank(r);
    } catch {
      // Silent — bar just hides until next refresh.
    }
  }, []);

  // Initial load + refresh on burn (instant) and rank-up (instant).
  useEffect(() => {
    refreshRank();
    const onBurn = () => refreshRank();
    const offRankUp = onRankUp(() => refreshRank());
    window.addEventListener('burn-result', onBurn);
    // Poll every 30s as a safety net for offline-accrual driven luxury
    // changes that don't fire a window event.
    const poll = setInterval(refreshRank, 30000);
    return () => {
      window.removeEventListener('burn-result', onBurn);
      offRankUp();
      clearInterval(poll);
    };
  }, [refreshRank]);

  const showProgress = rank != null && rank.next_threshold != null;
  const nextTier = rank?.next_rank ?? null;
  const pct = rank ? Math.round(Math.min(1, Math.max(0, rank.progress)) * 100) : 0;
  const currentLabel = rank?.rank ? TIER_LABEL[rank.rank] : 'Unranked';

  return (
    <div style={S.wrap}>
      <div style={S.bar}>
        {Object.entries(resources).map(([key, val]) => (
          <div key={key} style={S.item}>
            <span>{ICONS[key] || '📦'}</span>
            <span style={S.val}>{typeof val === 'number' ? val.toFixed(1) : val}</span>
            <span style={S.label}>{key}</span>
          </div>
        ))}
      </div>
      {showProgress && nextTier && (
        <div
          style={S.progressBar}
          title={`${currentLabel} → ${TIER_LABEL[nextTier]} (${(rank!.lifetime).toLocaleString()} / ${(rank!.next_threshold ?? 0).toLocaleString()} luxury used)`}
        >
          <div style={S.progressMeta}>
            <span style={{ color: rank?.rank ? TIER_COLOR[rank.rank] : '#A89378' }}>
              {currentLabel}
            </span>
            <span style={S.progressNums}>
              {rank!.lifetime.toLocaleString()} / {rank!.next_threshold!.toLocaleString()} 💎
            </span>
            <span style={{ color: TIER_COLOR[nextTier] }}>{TIER_LABEL[nextTier]}</span>
          </div>
          <div style={S.progressTrack}>
            <div
              style={{
                ...S.progressFill,
                width: `${pct}%`,
                background: `linear-gradient(90deg, ${TIER_COLOR[nextTier]}, ${TIER_COLOR[nextTier]}cc)`,
              }}
            />
          </div>
        </div>
      )}
      {rank && !showProgress && (
        <div style={S.maxedBanner}>Diamond rank — maxed.</div>
      )}
    </div>
  );
};

const S: Record<string, React.CSSProperties> = {
  wrap: {
    position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
    pointerEvents: 'auto', zIndex: 10, fontFamily: 'sans-serif',
  },
  bar: {
    display: 'flex', gap: 12, background: 'rgba(31,24,18,0.92)',
    border: '1px solid rgba(216,148,56,0.25)', borderRadius: 10,
    padding: '6px 16px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(245,230,208,0.06)',
  },
  item: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 },
  val: { fontWeight: 600, color: '#F5E6D0', fontVariantNumeric: 'tabular-nums' },
  label: { fontSize: 10, color: '#A89378', textTransform: 'capitalize' as const },

  progressBar: {
    width: 320,
    background: 'rgba(31,24,18,0.92)',
    border: '1px solid rgba(216,148,56,0.18)',
    borderRadius: 8,
    padding: '4px 10px 5px',
    display: 'flex', flexDirection: 'column', gap: 3,
    boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
  },
  progressMeta: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontSize: 9, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase' as const,
  },
  progressNums: { color: '#A89378', fontVariantNumeric: 'tabular-nums', letterSpacing: 0.2 },
  progressTrack: {
    position: 'relative',
    height: 6, width: '100%',
    background: 'rgba(0,0,0,0.45)',
    borderRadius: 3,
    overflow: 'hidden',
    boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.6)',
  },
  progressFill: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    borderRadius: 3,
    transition: 'width 0.3s ease',
  },
  maxedBanner: {
    fontSize: 9, color: '#B9F2FF', letterSpacing: 0.6,
    background: 'rgba(185,242,255,0.06)',
    border: '1px solid rgba(185,242,255,0.2)',
    borderRadius: 6, padding: '2px 8px',
  },
};
