import React, { useEffect, useState } from 'react';
import { onCreditsUpdate } from '../../network/Client';
import { getStoredPlayerId } from '../../network/wallet';
import { CURRENCY_NAME } from '@gamestu/shared';

/**
 * First-connect onboarding callout.
 *
 * Spec (thirdlife-updated-spec.md §11) locks starting balance to 0 — a
 * brand-new wallet must purchase $AMETA on-chain before they can do
 * anything meaningful in-game. This modal surfaces that contract on the
 * first credits=0 sync after a wallet connects, then suppresses for the
 * session via localStorage so people who genuinely spent down to zero
 * don't get nagged every login.
 *
 * The buy URL is env-overridable so non-prod builds can point at a
 * tutorial sandbox; default points at the project's get-ameta page.
 */

const BUY_URL =
  (import.meta as unknown as { env?: { VITE_BUY_AMETA_URL?: string } }).env?.VITE_BUY_AMETA_URL
  ?? 'https://thirdlifeworld.xyz/get-ameta';

const SUPPRESS_KEY_PREFIX = 'thirdlife.onboarding.dismissed.';

export const OnboardingModal: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [seenFirst, setSeenFirst] = useState(false);

  useEffect(() => {
    const off = onCreditsUpdate((credits) => {
      if (seenFirst) return;
      setSeenFirst(true);
      if (credits !== 0) return;
      const walletKey = getStoredPlayerId() ?? 'guest';
      if (localStorage.getItem(SUPPRESS_KEY_PREFIX + walletKey) === '1') return;
      setOpen(true);
    });
    return () => off();
  }, [seenFirst]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const dismiss = (): void => {
    const walletKey = getStoredPlayerId() ?? 'guest';
    localStorage.setItem(SUPPRESS_KEY_PREFIX + walletKey, '1');
    setOpen(false);
  };

  if (!open) return null;
  return (
    <div
      style={S.backdrop}
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div style={S.card} onClick={(e) => e.stopPropagation()}>
        <div id="onboarding-title" style={S.heading}>Welcome to ThirdLife</div>
        <div style={S.body}>
          Your wallet balance is <strong style={S.zero}>0 ${CURRENCY_NAME}</strong>.
          To claim land, hire agents, build, and trade, you need to buy
          ${CURRENCY_NAME} on-chain first.
        </div>
        <div style={S.hint}>
          A starter budget of ~<strong>1,000,000 ${CURRENCY_NAME}</strong> is enough to
          claim your first parcel, build a Tier&nbsp;I production building,
          and hire one in-game agent.
        </div>
        <div style={S.actions}>
          <a
            href={BUY_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={S.buyButton}
            onClick={dismiss}
          >
            Buy ${CURRENCY_NAME}
          </a>
          <button type="button" style={S.laterButton} onClick={dismiss}>
            Later
          </button>
        </div>
      </div>
    </div>
  );
};

const S: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'absolute', inset: 0, zIndex: 75,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'auto',
  },
  card: {
    background: 'linear-gradient(180deg, #2a1f18 0%, #1F1812 100%)',
    color: '#F5E6D0',
    padding: '24px 28px 20px',
    borderRadius: 14,
    boxShadow: '0 22px 60px rgba(0,0,0,0.65), inset 0 0 0 1px rgba(216,148,56,0.35)',
    display: 'flex', flexDirection: 'column', gap: 14,
    maxWidth: 420, width: '90vw',
  },
  heading: {
    fontSize: 22, fontWeight: 800, letterSpacing: 0.5,
    color: '#D89438',
    fontFamily: '"Fraunces", Georgia, serif',
  },
  body: { fontSize: 13, lineHeight: 1.5, color: '#F5E6D0' },
  zero: { color: '#B5563A' },
  hint: { fontSize: 12, color: '#A89378', lineHeight: 1.5 },
  actions: { display: 'flex', gap: 10, marginTop: 4, justifyContent: 'flex-end' },
  buyButton: {
    background: '#D89438', color: '#1F1812',
    padding: '8px 16px', borderRadius: 8,
    fontSize: 13, fontWeight: 700, letterSpacing: 0.3,
    textDecoration: 'none', cursor: 'pointer',
    border: '1px solid rgba(0,0,0,0.25)',
  },
  laterButton: {
    background: 'transparent', color: '#A89378',
    padding: '8px 14px', borderRadius: 8,
    fontSize: 13, fontWeight: 600,
    border: '1px solid rgba(216,148,56,0.30)',
    cursor: 'pointer',
  },
};
