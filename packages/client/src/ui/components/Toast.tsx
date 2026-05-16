import React, { useEffect, useState, useCallback } from 'react';
import { onPlayerAdd, onPlayerRemove, PlayerSnapshot } from '../../network/Client';

interface ToastItem {
  id: number;
  message: string;
  type: 'join' | 'leave';
}

let nextId = 0;

export const Toast: React.FC = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((message: string, type: 'join' | 'leave') => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  useEffect(() => {
    const unsubAdd = onPlayerAdd((_sessionId: string, player: PlayerSnapshot) => {
      // AI agents are persistent NPCs — they don't "join" in any meaningful
      // sense. Skip them so logging in doesn't fire a wall of toasts for
      // every agent in the world.
      if (player.bot_kind) return;
      addToast(`${player.name} joined`, 'join');
    });

    const unsubRemove = onPlayerRemove((sessionId: string) => {
      // Agent IDs look like 0x…:agent:<hex>. Skip those — agent removals
      // happen frequently (autopilot toggles, deletions) and aren't
      // human-facing "left" events.
      if (sessionId.includes(':agent:')) return;
      addToast(`Player ${sessionId.slice(0, 4)} left`, 'leave');
    });

    return () => {
      unsubAdd();
      unsubRemove();
    };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 180,
        right: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 100,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            backgroundColor: toast.type === 'join' ? 'rgba(34, 197, 94, 0.85)' : 'rgba(239, 68, 68, 0.85)',
            color: 'white',
            fontFamily: 'monospace',
            fontSize: 13,
            textShadow: '1px 1px 2px rgba(0,0,0,0.5)',
            animation: 'fadeIn 0.2s ease-in',
          }}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
};
