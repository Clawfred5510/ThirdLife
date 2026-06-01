import React, { useEffect, useState } from 'react';

/**
 * Full-screen "Loading game…" curtain shown between the wallet connect and the
 * live game. It stays up for a minimum duration AND until the scene is ready
 * (the Boot orchestrator owns that handoff) so the world never visibly pops or
 * builds in on the first frame. This component is purely presentational.
 *
 * Respects prefers-reduced-motion: the spinner falls back to a static dot.
 */
export const LoadingScreen: React.FC = () => {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [dots, setDots] = useState('');

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  // Animated ellipsis (cheap, motion-safe — text only, no transform).
  useEffect(() => {
    const iv = setInterval(() => setDots((d) => (d.length >= 3 ? '' : d + '.')), 400);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={S.screen} role="status" aria-live="polite" aria-label="Loading game">
      <style>{spinKeyframes}</style>
      <div style={{ ...S.spinner, animation: reduceMotion ? 'none' : 'tl-spin 0.9s linear infinite' }} aria-hidden />
      <div style={S.text}>Loading game{dots}</div>
      <div style={S.hint}>Warming up the world so it looks its best.</div>
    </div>
  );
};

const spinKeyframes = '@keyframes tl-spin { to { transform: rotate(360deg); } }';

const S: Record<string, React.CSSProperties> = {
  screen: {
    position: 'fixed', inset: 0, zIndex: 950,
    background: '#000',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'auto',
    fontFamily: '"Nunito", system-ui, sans-serif',
    gap: 18,
  },
  spinner: {
    width: 46, height: 46, borderRadius: '50%',
    border: '4px solid rgba(216,148,56,0.25)', borderTopColor: '#D89438',
  },
  text: { fontSize: 20, fontWeight: 800, color: '#F5E6D0', fontFamily: '"Fraunces", Georgia, serif' },
  hint: { fontSize: 13, color: 'rgba(245,230,208,0.55)' },
};
