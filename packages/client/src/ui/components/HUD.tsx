import React from 'react';

export const HUD: React.FC = () => {
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
    </div>
  );
};
