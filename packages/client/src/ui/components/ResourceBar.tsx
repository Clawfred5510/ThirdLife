import React, { useEffect, useState } from 'react';
import { onParcelState, onPlayerAdd, getSessionId } from '../../network/Client';
import { PlayerResources } from '@gamestu/shared';

const ICONS: Record<string, string> = { food: '🌾', materials: '⛏️', energy: '⚡', luxury: '💎' };

export const ResourceBar: React.FC = () => {
  const [resources, setResources] = useState<PlayerResources>({ food: 0, materials: 0, energy: 0, luxury: 0 });

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) setResources(detail);
    };
    window.addEventListener('resource-update', handler);
    return () => window.removeEventListener('resource-update', handler);
  }, []);

  return (
    <div style={S.bar}>
      {Object.entries(resources).map(([key, val]) => (
        <div key={key} style={S.item}>
          <span>{ICONS[key] || '📦'}</span>
          <span style={S.val}>{typeof val === 'number' ? val.toFixed(1) : val}</span>
          <span style={S.label}>{key}</span>
        </div>
      ))}
    </div>
  );
};

const S: Record<string, React.CSSProperties> = {
  bar: {
    position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
    display: 'flex', gap: 12, background: 'rgba(12,14,24,0.85)',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10,
    padding: '6px 16px', pointerEvents: 'auto', zIndex: 10, fontFamily: 'sans-serif',
  },
  item: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 },
  val: { fontWeight: 600, color: '#e4e4ef' },
  label: { fontSize: 10, color: '#8b8b9a', textTransform: 'capitalize' as const },
};
