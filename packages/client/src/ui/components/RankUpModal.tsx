import React, { useEffect, useState } from 'react';
import { onRankUp } from '../../network/Client';

/**
 * Rank-up celebration modal.
 *
 * Listens for MessageType.RANK_UP from the server (Phase 4 burn handler
 * broadcasts on every promotion). When the event matches the local
 * player, shows a centered card with the old crest, an arrow, the new
 * crest, and a confetti burst. Auto-dismisses after a few seconds; ESC
 * or any click also closes.
 *
 * Confetti is a pure-CSS particle burst (60 absolute-positioned spans
 * with randomized hue + start angle + drift) — no extra deps, no
 * Babylon allocation per burst, no GPU pressure on low-end hardware.
 */

type Tier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';

const TIER_COLOR: Record<Tier, string> = {
  bronze:   '#CD7F32',
  silver:   '#C0C0C0',
  gold:     '#FFD700',
  platinum: '#E5E4E2',
  diamond:  '#B9F2FF',
};

const TIER_LABEL: Record<Tier, string> = {
  bronze:   'Bronze',
  silver:   'Silver',
  gold:     'Gold',
  platinum: 'Platinum',
  diamond:  'Diamond',
};

interface RankUpEvent {
  player_id: string;
  from: Tier | null;
  to: Tier;
  lifetime: number;
}

const CONFETTI_COUNT = 60;
const PALETTE = ['#F5E6D0', '#D89438', '#B5563A', '#3F7A3D', '#5C6F8A', '#FFD700', '#B9F2FF'];

export const RankUpModal: React.FC = () => {
  const [event, setEvent] = useState<RankUpEvent | null>(null);

  useEffect(() => {
    const off = onRankUp((e) => setEvent(e));
    return () => off();
  }, []);

  // Auto-dismiss after 6 seconds.
  useEffect(() => {
    if (!event) return;
    const id = setTimeout(() => setEvent(null), 6000);
    return () => clearTimeout(id);
  }, [event]);

  useEffect(() => {
    if (!event) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEvent(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [event]);

  if (!event) return null;
  const fromTier: Tier = event.from ?? 'bronze';
  const toTier: Tier = event.to;
  return (
    <div style={S.backdrop} onClick={() => setEvent(null)} role="dialog" aria-label="Rank up">
      <ConfettiBurst />
      <div style={S.card} onClick={(e) => e.stopPropagation()}>
        <div style={S.heading}>RANK UP</div>
        <div style={S.subheading}>Lifetime luxury used: {event.lifetime.toLocaleString()}</div>
        <div style={S.crestRow}>
          <Crest tier={fromTier} muted />
          <div style={S.arrow}>→</div>
          <Crest tier={toTier} />
        </div>
        <div style={S.flavor}>
          You are now <strong style={{ color: TIER_COLOR[toTier] }}>{TIER_LABEL[toTier]}</strong>.
        </div>
      </div>
    </div>
  );
};

const Crest: React.FC<{ tier: Tier; muted?: boolean }> = ({ tier, muted }) => {
  const color = TIER_COLOR[tier];
  return (
    <div
      style={{
        ...S.crest,
        background: `radial-gradient(circle at 35% 30%, ${color}, ${color}99 60%, ${color}33)`,
        boxShadow: muted ? 'none' : `0 0 22px ${color}99`,
        opacity: muted ? 0.45 : 1,
      }}
      aria-label={`${TIER_LABEL[tier]} crest`}
    >
      <div style={{ ...S.crestInner, color: muted ? '#1f1812aa' : '#1f1812' }}>
        {TIER_LABEL[tier][0]}
      </div>
    </div>
  );
};

const ConfettiBurst: React.FC = () => {
  return (
    <div style={S.confettiWrap} aria-hidden>
      {Array.from({ length: CONFETTI_COUNT }).map((_, i) => {
        const angle = (i / CONFETTI_COUNT) * Math.PI * 2 + Math.random() * 0.3;
        const distance = 200 + Math.random() * 220;
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance + Math.random() * 80;
        const delay = Math.random() * 200;
        const color = PALETTE[i % PALETTE.length];
        const size = 6 + Math.random() * 4;
        return (
          <span
            key={i}
            style={{
              ...S.confetti,
              background: color,
              width: size,
              height: size * 0.4,
              animationDelay: `${delay}ms`,
              // CSS variables consumed by the keyframes.
              ['--dx' as any]: `${dx}px`,
              ['--dy' as any]: `${dy}px`,
              ['--spin' as any]: `${(Math.random() - 0.5) * 720}deg`,
            }}
          />
        );
      })}
      <style>{CONFETTI_KEYFRAMES}</style>
    </div>
  );
};

const CONFETTI_KEYFRAMES = `
@keyframes tl-confetti {
  0%   { transform: translate(0, 0) rotate(0deg); opacity: 1; }
  100% { transform: translate(var(--dx), var(--dy)) rotate(var(--spin)); opacity: 0; }
}
`;

const S: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'absolute', inset: 0, zIndex: 70,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'auto', overflow: 'hidden',
  },
  confettiWrap: {
    position: 'absolute', inset: 0,
    pointerEvents: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  confetti: {
    position: 'absolute', left: '50%', top: '50%',
    borderRadius: 1,
    animation: 'tl-confetti 1.6s ease-out forwards',
  },
  card: {
    position: 'relative',
    background: 'linear-gradient(180deg, #2a1f18 0%, #1F1812 100%)',
    color: '#F5E6D0',
    padding: '24px 36px',
    borderRadius: 14,
    boxShadow: '0 22px 60px rgba(0,0,0,0.65), inset 0 0 0 1px rgba(216,148,56,0.35)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
    minWidth: 320,
  },
  heading: {
    fontSize: 28, fontWeight: 800, letterSpacing: 4,
    color: '#D89438', fontFamily: 'Georgia, "Source Serif", serif',
  },
  subheading: { fontSize: 11, color: '#A89378', letterSpacing: 0.4 },
  crestRow: { display: 'flex', alignItems: 'center', gap: 18, margin: '6px 0' },
  arrow: { fontSize: 30, color: '#A89378' },
  crest: {
    width: 80, height: 80, borderRadius: 40,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'transform 0.3s',
  },
  crestInner: {
    fontSize: 30, fontWeight: 900, fontFamily: 'Georgia, serif',
    textShadow: '0 1px 0 rgba(255,255,255,0.4)',
  },
  flavor: { fontSize: 13, color: '#F5E6D0' },
};
