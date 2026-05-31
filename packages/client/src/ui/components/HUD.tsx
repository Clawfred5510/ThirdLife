import React, { useEffect, useState } from 'react';
import { onPlayerAdd, onPlayerRemove, getRoom } from '../../network/Client';
import { apiGet } from '../../network/api';
import { useViewport } from '../hooks/useViewport';

interface WorldInfo { tick: number; gdp: number; }

export const HUD: React.FC = () => {
  const [playerCount, setPlayerCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const [world, setWorld] = useState<WorldInfo>({ tick: 0, gdp: 0 });
  const vp = useViewport();

  useEffect(() => {
    const interval = setInterval(() => {
      const room = getRoom();
      setConnected(room !== null);
    }, 1000);

    const unsubAdd = onPlayerAdd(() => {
      setPlayerCount((prev) => prev + 1);
    });

    const unsubRemove = onPlayerRemove(() => {
      setPlayerCount((prev) => Math.max(0, prev - 1));
    });

    const loadWorld = () => {
      apiGet<WorldInfo>('/world')
        .then((w) => setWorld({ tick: w.tick ?? 0, gdp: w.gdp ?? 0 }))
        .catch(() => {});
    };
    loadWorld();
    const worldInterval = setInterval(loadWorld, 15_000);

    return () => {
      clearInterval(interval);
      clearInterval(worldInterval);
      unsubAdd();
      unsubRemove();
    };
  }, []);

  // Mobile: collapse to a tiny status dot in the top-right. Title +
  // tick/GDP + player count are eaten by the existing space-shortage —
  // they're stats you can browse in the Notifications app instead.
  if (vp.isMobile) {
    return (
      <div
        style={{
          position: 'absolute',
          top: 16, right: 70,         // 70px of inset leaves room for the Minimap top-right corner.
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 8px',
          background: 'rgba(0,0,0,0.5)',
          borderRadius: 12,
          color: '#F5E6D0',
          fontFamily: 'sans-serif',
          fontSize: 10,
          pointerEvents: 'none',
        }}
      >
        <span
          style={{
            width: 6, height: 6, borderRadius: '50%',
            backgroundColor: connected ? '#3F7A3D' : '#B5563A',
          }}
        />
        <span>{playerCount}</span>
      </div>
    );
  }

  return (
    // In-flow inside App's desktop left-stack flex column (positioning owned
    // there). pointerEvents:none so camera-drag works over the HUD text.
    <div
      style={{
        position: 'relative',
        color: '#FAF3E0',
        fontFamily: '"Nunito", system-ui, sans-serif',
        fontSize: 13,
        fontWeight: 600,
        lineHeight: 1.3,
        textShadow: '1px 2px 0 rgba(58,42,31,0.6)',
        pointerEvents: 'none',
      }}
    >
      <h2 style={{
        margin: 0,
        fontSize: 26,
        fontFamily: '"Fraunces", Georgia, serif',
        fontWeight: 800,
        letterSpacing: 0.3,
        color: '#FAF3E0',
      }}>
        ThirdLife
      </h2>
      <p style={{
        margin: '2px 0',
        color: '#E5A845',
        fontFamily: '"Nunito", sans-serif',
        fontSize: 11,
        fontWeight: 600,
      }}>
        Early Development Build
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: connected ? '#3F7A3D' : '#B5563A',
            display: 'inline-block',
          }}
        />
        <span style={{ opacity: 0.85 }}>{connected ? 'Connected' : 'Disconnected'}</span>
      </div>
      <p style={{ margin: '4px 0', opacity: 0.85 }}>Players: {playerCount}</p>
      <p style={{ margin: '4px 0', opacity: 0.85, fontVariantNumeric: 'tabular-nums' }}>
        Tick #{world.tick} · GDP {world.gdp.toLocaleString()} $AMETA
      </p>
    </div>
  );
};
