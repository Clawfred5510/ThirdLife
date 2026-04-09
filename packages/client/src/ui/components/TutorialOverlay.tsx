import React, { useEffect, useState, useCallback, useRef } from 'react';
import { onTutorial } from '../../network/Client';

type Phase = 'idle' | 'fadeIn' | 'hold' | 'fadeOut';

export const TutorialOverlay: React.FC = () => {
  const [currentMessage, setCurrentMessage] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const queueRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNext = useCallback(() => {
    if (queueRef.current.length === 0) {
      setCurrentMessage(null);
      setPhase('idle');
      return;
    }
    const next = queueRef.current.shift()!;
    setCurrentMessage(next);
    setPhase('fadeIn');

    timerRef.current = setTimeout(() => {
      setPhase('hold');
      timerRef.current = setTimeout(() => {
        setPhase('fadeOut');
        timerRef.current = setTimeout(() => {
          showNext();
        }, 500);
      }, 3000);
    }, 500);
  }, []);

  useEffect(() => {
    const unsub = onTutorial((message: string) => {
      queueRef.current.push(message);
      if (phase === 'idle') {
        showNext();
      }
    });
    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [phase, showNext]);

  if (!currentMessage || phase === 'idle') return null;

  const opacity = phase === 'fadeIn' ? 1 : phase === 'hold' ? 1 : 0;

  return (
    <div
      style={{
        position: 'absolute',
        top: '30%',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 200,
        pointerEvents: 'none',
        opacity,
        transition: 'opacity 0.5s ease-in-out',
      }}
    >
      <div
        style={{
          background: 'rgba(0, 0, 0, 0.6)',
          borderRadius: 24,
          padding: '12px 32px',
          color: '#ffffff',
          fontSize: 24,
          fontFamily: '"Courier New", Courier, monospace',
          textShadow: '2px 2px 4px rgba(0, 0, 0, 0.8)',
          textAlign: 'center',
          maxWidth: 600,
        }}
      >
        {currentMessage}
      </div>
    </div>
  );
};
