import React, { useEffect, useState } from 'react';
import { onCreditsUpdate } from '../../network/Client';

export const Wallet: React.FC = () => {
  const [credits, setCredits] = useState(0);

  useEffect(() => {
    onCreditsUpdate((amount: number) => {
      setCredits(amount);
    });
  }, []);

  return (
    <div
      style={{
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
      }}
    >
      <span style={{ opacity: 0.8 }}>CR</span>
      <span style={{ color: '#facc15', fontWeight: 'bold', fontSize: 16 }}>
        {credits.toLocaleString()}
      </span>
    </div>
  );
};
