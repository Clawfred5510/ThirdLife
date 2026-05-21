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

  // Mobile: dock to top-center as a pill (the desktop top-left position
  // collides with the chat FAB at top-left, and the HUD strip on mobile
  // is now in the top-right corner).
  const wrap: React.CSSProperties = vp.isMobile
    ? {
        position: 'absolute',
        top: 16, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.55)',
        borderRadius: 14,
        padding: '4px 12px',
        color: 'white',
        fontFamily: 'monospace',
        fontSize: 12,
        display: 'flex', alignItems: 'center', gap: 4,
      }
    : {
        position: 'absolute',
        top: 120,
        left: 16,
        color: 'white',
        fontFamily: 'monospace',
        fontSize: 14,
        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      };

  return (
    <div style={wrap}>
      <span style={{ opacity: 0.8 }}>$AMETA</span>
      <span style={{ color: '#facc15', fontWeight: 'bold', fontSize: vp.isMobile ? 13 : 16 }}>
        {credits.toLocaleString()}
      </span>
    </div>
  );
};
