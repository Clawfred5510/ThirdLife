import React, { useEffect, useRef, useCallback } from 'react';
import {
  onPlayerAdd,
  onPlayerRemove,
  onPlayerChange,
  getSessionId,
  PlayerSnapshot,
} from '../../network/Client';

const SIZE = 150;
const WORLD_MIN = -1000;
const WORLD_MAX = 1000;
const WORLD_RANGE = WORLD_MAX - WORLD_MIN; // 2000

interface DistrictZone {
  label: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  color: string;
}

const DISTRICTS: DistrictZone[] = [
  { label: 'Downtown', x1: 100, z1: -600, x2: 800, z2: 100, color: 'rgba(100,110,120,0.4)' },
  { label: 'Residential', x1: -900, z1: 100, x2: -100, z2: 900, color: 'rgba(80,130,60,0.4)' },
  { label: 'Industrial', x1: 100, z1: 200, x2: 900, z2: 900, color: 'rgba(100,100,90,0.4)' },
  { label: 'Waterfront', x1: 200, z1: -1000, x2: 1000, z2: -500, color: 'rgba(150,140,100,0.4)' },
  { label: 'Entertainment', x1: -900, z1: -600, x2: -100, z2: 100, color: 'rgba(110,80,120,0.4)' },
];

function worldToMinimap(wx: number, wz: number): [number, number] {
  const mx = ((wx - WORLD_MIN) / WORLD_RANGE) * SIZE;
  const my = ((wz - WORLD_MIN) / WORLD_RANGE) * SIZE;
  return [mx, my];
}

export const Minimap: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playersRef = useRef<Map<string, PlayerSnapshot>>(new Map());
  const rafRef = useRef<number>(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, SIZE, SIZE);

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // District zones
    for (const d of DISTRICTS) {
      const [x1, y1] = worldToMinimap(d.x1, d.z1);
      const [x2, y2] = worldToMinimap(d.x2, d.z2);
      ctx.fillStyle = d.color;
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    }

    const myId = getSessionId();

    // Draw players
    for (const [sessionId, player] of playersRef.current) {
      const [mx, my] = worldToMinimap(player.x, player.z);
      if (sessionId === myId) {
        // Local player: white dot, slightly larger
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(mx, my, 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Other players: red dot
        ctx.fillStyle = '#ff4444';
        ctx.beginPath();
        ctx.arc(mx, my, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, []);

  useEffect(() => {
    const handleAdd = (sessionId: string, player: PlayerSnapshot) => {
      playersRef.current.set(sessionId, player);
    };
    const handleRemove = (sessionId: string) => {
      playersRef.current.delete(sessionId);
    };
    const handleChange = (sessionId: string, player: PlayerSnapshot) => {
      playersRef.current.set(sessionId, player);
    };

    onPlayerAdd(handleAdd);
    onPlayerRemove(handleRemove);
    onPlayerChange(handleChange);

    // Draw loop at ~10 fps
    let lastTime = 0;
    const loop = (time: number) => {
      if (time - lastTime >= 100) {
        draw();
        lastTime = time;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        width: SIZE,
        height: SIZE,
        borderRadius: 4,
        pointerEvents: 'none',
      }}
    />
  );
};
