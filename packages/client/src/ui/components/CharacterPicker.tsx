import React, { useEffect, useState, useCallback } from 'react';
import { onPlayerAdd, onPlayerChange, getLocalPlayer, getSessionId, sendUpdateAppearance, PlayerSnapshot } from '../../network/Client';
import type { CharacterType } from '@gamestu/shared';

/**
 * One-time "Choose your character" picker (Male / Female), shown on first login.
 *
 * The choice is server-authoritative + WRITE-ONCE: a brand-new player's
 * appearance has no `character` yet (undefined), which is the signal to show
 * this. On pick we send UPDATE_APPEARANCE({character}); the server accepts it
 * only while still unchosen, stores it in the appearance blob, and echoes it
 * back — so the picker never reappears (no localStorage flag needed, and it
 * works across devices). Blocking: the player must pick to proceed.
 */
export const CharacterPicker: React.FC = () => {
  const [needsPick, setNeedsPick] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const evaluate = (id: string, snap: PlayerSnapshot): void => {
      if (id !== getSessionId()) return;       // local player only
      if (snap.bot_kind) return;               // never for agents (defensive)
      // Undefined character = not yet chosen → show the picker. Once the server
      // echoes a chosen value, this flips false and the modal closes.
      setNeedsPick(snap.appearance?.character === undefined);
    };
    const offAdd = onPlayerAdd(evaluate);
    const offChange = onPlayerChange(evaluate);
    // Catch the case where the local snapshot already arrived before mount.
    const me = getLocalPlayer();
    const myId = getSessionId();
    if (me && myId && !me.bot_kind) setNeedsPick(me.appearance?.character === undefined);
    return () => { offAdd(); offChange(); };
  }, []);

  const pick = useCallback((character: CharacterType) => {
    if (sending) return;
    setSending(true);
    sendUpdateAppearance({ character });
    // Close optimistically; the server echo (PLAYER_UPDATE) confirms + swaps the
    // avatar GLB. If the write somehow fails, the next snapshot re-opens it.
    setNeedsPick(false);
    setSending(false);
  }, [sending]);

  if (!needsPick) return null;

  return (
    <div style={S.backdrop} role="dialog" aria-modal="true" aria-labelledby="char-title">
      <div style={S.card} onClick={(e) => e.stopPropagation()}>
        <div id="char-title" style={S.heading}>Choose your character</div>
        <div style={S.sub}>This is set once when you join — pick the look you want to play as.</div>
        <div style={S.options}>
          <button style={S.option} onClick={() => pick('male')} disabled={sending} aria-label="Play as male">
            <span style={S.glyph} aria-hidden>🧑‍🚀</span>
            <span style={S.optLabel}>Male</span>
          </button>
          <button style={S.option} onClick={() => pick('female')} disabled={sending} aria-label="Play as female">
            <span style={S.glyph} aria-hidden>👩‍🚀</span>
            <span style={S.optLabel}>Female</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const S: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'absolute', inset: 0, zIndex: 120,
    background: 'rgba(8,10,14,0.72)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'auto',
    fontFamily: '"Nunito", system-ui, sans-serif',
  },
  card: {
    background: 'linear-gradient(180deg, #2a1f18 0%, #1F1812 100%)',
    color: '#F5E6D0',
    padding: '26px 30px 24px',
    borderRadius: 16,
    boxShadow: '0 22px 60px rgba(0,0,0,0.65), inset 0 0 0 1px rgba(216,148,56,0.35)',
    display: 'flex', flexDirection: 'column', gap: 10,
    maxWidth: 460, width: '92vw', alignItems: 'center',
  },
  heading: {
    fontSize: 24, fontWeight: 800, letterSpacing: 0.5, color: '#D89438',
    fontFamily: '"Fraunces", Georgia, serif',
  },
  sub: { fontSize: 13, color: '#A89378', lineHeight: 1.4, textAlign: 'center', marginBottom: 8 },
  options: { display: 'flex', gap: 16, width: '100%', justifyContent: 'center' },
  option: {
    flex: 1, maxWidth: 170,
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
    padding: '20px 12px', borderRadius: 14,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(216,148,56,0.35)',
    color: '#F5E6D0', cursor: 'pointer',
    fontFamily: '"Nunito", system-ui, sans-serif',
  },
  glyph: { fontSize: 52, lineHeight: 1 },
  optLabel: { fontSize: 16, fontWeight: 800 },
};
