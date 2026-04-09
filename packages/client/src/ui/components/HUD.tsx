import React, { useEffect, useState } from 'react';
import { onPlayerAdd, onPlayerRemove, getRoom } from '../../network/Client';

export const HUD: React.FC = () => {
  const [playerCount, setPlayerCount] = useState(0);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Check connection status periodically
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

    return () => {
      clearInterval(interval);
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
        color: 'white',
        fontFamily: 'monospace',
        fontSize: 14,
        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
      }}
    >
      <h2 style={{ margin: 0, fontSize: 18 }}>ThirdLife</h2>
      <p style={{ margin: '4px 0', opacity: 0.7 }}>Early Development Build</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: connected ? '#22c55e' : '#ef4444',
            display: 'inline-block',
          }}
        />
        <span style={{ opacity: 0.8 }}>{connected ? 'Connected' : 'Disconnected'}</span>
      </div>
      <p style={{ margin: '4px 0', opacity: 0.8 }}>Players: {playerCount}</p>
    </div>
  );
};
