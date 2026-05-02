import React, { useEffect, useState } from 'react';
import { onPlayerAdd, onPlayerRemove, getRoom } from '../../network/Client';
import { apiGet } from '../../network/api';

interface WorldInfo { tick: number; gdp: number; }

export const HUD: React.FC = () => {
  const [playerCount, setPlayerCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const [world, setWorld] = useState<WorldInfo>({ tick: 0, gdp: 0 });

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

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        color: '#F5E6D0',
        fontFamily: 'sans-serif',
        fontSize: 13,
        textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
      }}
    >
      <h2 style={{ margin: 0, fontSize: 22, fontFamily: 'Georgia, "Source Serif", serif', fontWeight: 600, letterSpacing: 0.5 }}>ThirdLife</h2>
      <p style={{ margin: '2px 0', opacity: 0.7, fontStyle: 'italic', fontFamily: 'Georgia, serif', fontSize: 11 }}>Early Development Build</p>
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
