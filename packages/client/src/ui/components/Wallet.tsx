import React, { useEffect, useState } from 'react';
import { onCreditsUpdate } from '../../network/Client';
import { useViewport } from '../hooks/useViewport';

export const Wallet: React.FC = () => {
  const [credits, setCredits] = useState(0);
  const vp = useViewport();

  useEffect(() => {
    const unsub = onCreditsUpdate((amount: number) => {
      setCredits(amount);
    });
    return unsub;
  }, []);

  // Mobile: dock just right of the chat FAB (FAB at top:16 left:16 + 44px)
  // so the wallet never crosses center where it would collide with the
  // minimap on the right.
  const wrap: React.CSSProperties = vp.isMobile
    ? {
        position: 'absolute',
        top: 18, left: 70,
        background: 'rgba(0,0,0,0.55)',
        borderRadius: 14,
        padding: '4px 10px',
        color: 'white',
        fontFamily: 'monospace',
        fontSize: 11,
        display: 'flex', alignItems: 'center', gap: 4,
        maxWidth: 'calc(100vw - 184px)', // leave room for minimap (100 + 16 right) + chat FAB (60 left)
        overflow: 'hidden',
        whiteSpace: 'nowrap' as const,
      }
    : {
        // In-flow inside App's desktop left-stack flex column (positioning
        // owned there). pointerEvents:none so camera-drag works over it.
        position: 'relative',
        color: 'white',
        fontFamily: 'monospace',
        fontSize: 14,
        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: 360,
        whiteSpace: 'nowrap' as const,
        pointerEvents: 'none',
      };

  // On a narrow phone, abbreviate large balances (50,000,000 → 50M) so
  // the pill doesn't truncate. Desktop keeps the full formatted number.
  const formatted = vp.isMobile
    ? credits >= 1_000_000
      ? `${(credits / 1_000_000).toFixed(credits >= 10_000_000 ? 0 : 1)}M`
      : credits >= 1_000
        ? `${(credits / 1_000).toFixed(credits >= 10_000 ? 0 : 1)}K`
        : String(credits)
    : credits.toLocaleString();

  return (
    <div style={wrap}>
      <span style={{ opacity: 0.8 }}>$AMETA</span>
      <span style={{ color: '#facc15', fontWeight: 'bold', fontSize: vp.isMobile ? 13 : 16 }}>
        {formatted}
      </span>
    </div>
  );
};
