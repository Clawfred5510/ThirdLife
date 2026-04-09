import React, { useEffect, useState } from 'react';
import { BUS_STOPS } from '@gamestu/shared';
import { sendFastTravel } from '../../network/Client';

export const FastTravel: React.FC = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyT' && !e.repeat) {
        // Don't open if user is typing in an input/textarea
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        setOpen((prev) => !prev);
      }
      if (e.code === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;

  const handleSelect = (index: number) => {
    sendFastTravel(index);
    setOpen(false);
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 900,
        pointerEvents: 'auto',
      }}
      onClick={() => setOpen(false)}
    >
      <div
        style={{
          background: 'rgba(15, 15, 25, 0.92)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: 12,
          padding: '24px 28px',
          minWidth: 280,
          color: '#fff',
          fontFamily: 'sans-serif',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 16px', fontSize: 18, textAlign: 'center', color: '#8cf' }}>
          Bus Stop Fast Travel
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {BUS_STOPS.map((stop, i) => (
            <button
              key={stop.name}
              onClick={() => handleSelect(i)}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 6,
                padding: '10px 16px',
                color: '#fff',
                fontSize: 14,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(100, 180, 255, 0.2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
            >
              {stop.name}
            </button>
          ))}
        </div>
        <p style={{ margin: '14px 0 0', fontSize: 11, color: '#888', textAlign: 'center' }}>
          Press T to toggle &middot; ESC to close
        </p>
      </div>
    </div>
  );
};
