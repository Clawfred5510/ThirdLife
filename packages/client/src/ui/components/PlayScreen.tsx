import React from 'react';

interface Props {
  onPlay: () => void;
  /** True while we're checking the stored wallet / opening the picker — keeps
   *  the button from being double-clicked and shows progress. */
  busy?: boolean;
}

/**
 * The black entry screen with a single "Play Game" button. Shown after the
 * site gate (if any) and before the wallet connect. The 3D canvas behind this
 * is intentionally not started yet, so the screen is a clean black.
 */
export const PlayScreen: React.FC<Props> = ({ onPlay, busy }) => {
  return (
    <div style={S.screen}>
      <div style={S.brand}>ThirdLife</div>
      <div style={S.tag}>A shared city. Claim land. Build a life.</div>
      <button
        style={{ ...S.button, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}
        onClick={onPlay}
        disabled={busy}
        autoFocus
      >
        {busy ? 'Connecting…' : 'Play Game'}
      </button>
      <div style={S.note}>A connected wallet is required to play.</div>
    </div>
  );
};

const S: Record<string, React.CSSProperties> = {
  screen: {
    // Below WalletPicker (z 200): in the wallet phase this screen stays as the
    // black backdrop and the connect popup appears OVER it. Still above the
    // idle 3D canvas (z 0).
    position: 'fixed', inset: 0, zIndex: 100,
    background: '#000',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'auto',
    fontFamily: '"Nunito", system-ui, sans-serif',
    padding: 20,
  },
  brand: {
    fontSize: 'clamp(40px, 9vw, 72px)', fontWeight: 800,
    fontFamily: '"Fraunces", Georgia, serif', color: '#F5E6D0', letterSpacing: 1,
  },
  tag: { fontSize: 15, color: 'rgba(245,230,208,0.7)', marginTop: 8, marginBottom: 40, textAlign: 'center' },
  button: {
    padding: '14px 48px', borderRadius: 999,
    background: '#D89438', color: '#1b1108', border: 'none',
    fontSize: 18, fontWeight: 800, fontFamily: '"Nunito", system-ui, sans-serif',
    boxShadow: '0 8px 28px rgba(216,148,56,0.4)',
  },
  note: { fontSize: 12, color: 'rgba(245,230,208,0.45)', marginTop: 22 },
};
