import React, { useEffect, useRef, useState } from 'react';
import {
  WORLD_HALF, GRID_COLS, GRID_ROWS, LANDMARKS,
} from '@gamestu/shared';
import type { ParcelData } from '@gamestu/shared';
import { apiGet } from '../../network/api';
import {
  onPlayerAdd, onPlayerRemove, onPlayerChange,
  getSessionId, getLocalPlayer, PlayerSnapshot,
} from '../../network/Client';

/**
 * Full-screen map opened by clicking the minimap. Shows landmarks,
 * claimed parcels (colored by owner), the local player's position
 * with facing direction, and remote players/agents as dots.
 */

const LANDMARK_GLYPH: Record<string, string> = {
  town_hall: '★', monument: '♦', gate: '⌂', park: '✿', harbor: '⚓',
};

/** Symbols shown on the map, paired with their meaning for the legend. */
const LEGEND: Array<{ glyph: string; label: string; color: string }> = [
  { glyph: '★', label: 'Town Hall',            color: '#FFFFFF' },
  { glyph: '⌂', label: 'Gate',                 color: '#FFE08A' },
  { glyph: '♦', label: 'Monument',             color: '#FFE08A' },
  { glyph: '✿', label: 'Park',                 color: '#FFE08A' },
  { glyph: '⚓', label: 'Harbor',               color: '#FFE08A' },
  { glyph: '■', label: 'Claimed parcel (color = owner)', color: '#4A90D9' },
  { glyph: '▲', label: 'You',                  color: '#FFFFFF' },
  { glyph: '●', label: 'Other players & agents', color: '#FF6B6B' },
];

const STRIDE = 48; // mirror of buildings.ts

export const BigMap: React.FC = () => {
  const [open, setOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playersRef = useRef<Map<string, PlayerSnapshot>>(new Map());
  const parcelsRef = useRef<ParcelData[]>([]);
  const rafRef = useRef<number>(0);

  // External trigger: click on minimap dispatches `tl-open-bigmap`.
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('tl-open-bigmap', handler);
    return () => window.removeEventListener('tl-open-bigmap', handler);
  }, []);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Subscriptions
  useEffect(() => {
    const handleAdd = (sid: string, p: PlayerSnapshot) => { playersRef.current.set(sid, p); };
    const handleRemove = (sid: string) => { playersRef.current.delete(sid); };
    const handleChange = (sid: string, p: PlayerSnapshot) => { playersRef.current.set(sid, p); };
    const unsubA = onPlayerAdd(handleAdd);
    const unsubR = onPlayerRemove(handleRemove);
    const unsubC = onPlayerChange(handleChange);
    return () => { unsubA(); unsubR(); unsubC(); };
  }, []);

  // Pull parcels from /world when opened (cheaper than relying on Colyseus state)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiGet<{ parcels_data: ParcelData[] }>('/world')
      .then((r) => { if (!cancelled) parcelsRef.current = r.parcels_data ?? []; })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  // Render loop while open — ~10 fps so the player indicator tracks
  useEffect(() => {
    if (!open) return;
    let last = 0;
    const loop = (t: number) => {
      if (t - last >= 100) { draw(); last = t; }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [open]);

  function worldToCanvas(wx: number, wz: number, W: number, H: number): [number, number] {
    const mx = ((wx + WORLD_HALF) / (WORLD_HALF * 2)) * W;
    const my = ((-wz + WORLD_HALF) / (WORLD_HALF * 2)) * H;
    return [mx, my];
  }

  function gridToCanvas(gx: number, gy: number, W: number, H: number): [number, number] {
    const wx = gx * STRIDE - WORLD_HALF + 20;
    const wz = gy * STRIDE - WORLD_HALF + 20;
    return worldToCanvas(wx, wz, W, H);
  }

  function draw() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const W = c.width, H = c.height;
    const cellW = W / GRID_COLS;
    const cellH = H / GRID_ROWS;

    ctx.fillStyle = '#1A1812';
    ctx.fillRect(0, 0, W, H);

    // Claimed parcels
    for (const p of parcelsRef.current) {
      if (!p.owner_id) continue;
      ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#4a90d9';
      ctx.fillRect(p.grid_x * cellW + 1, p.grid_y * cellH + 1, cellW - 2, cellH - 2);
    }

    // Grid lines every 5 cells
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    for (let gx = 0; gx <= GRID_COLS; gx += 5) {
      ctx.beginPath(); ctx.moveTo(gx * cellW, 0); ctx.lineTo(gx * cellW, H); ctx.stroke();
    }
    for (let gy = 0; gy <= GRID_ROWS; gy += 5) {
      ctx.beginPath(); ctx.moveTo(0, gy * cellH); ctx.lineTo(W, gy * cellH); ctx.stroke();
    }

    // Landmarks
    ctx.font = 'bold 18px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const lm of LANDMARKS) {
      const gx = Math.floor(lm.parcelId / GRID_COLS);
      const gy = lm.parcelId % GRID_COLS;
      const [cx, cy] = gridToCanvas(gx, gy, W, H);
      ctx.fillStyle = lm.type === 'town_hall' ? '#fff' : '#FFE08A';
      ctx.fillText(LANDMARK_GLYPH[lm.type] ?? '◆', cx, cy);
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'top';

    // Other players (small red dots)
    const myId = getSessionId();
    ctx.fillStyle = '#FF6B6B';
    for (const [sid, p] of playersRef.current) {
      if (sid === myId) continue;
      const [px, py] = worldToCanvas(p.x, p.z, W, H);
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Local player — same triangle indicator as the minimap, scaled
    // up so it reads at this zoom.
    const me = getLocalPlayer();
    if (me) {
      const [px, py] = worldToCanvas(me.x, me.z, W, H);
      const yaw = me.rotation ?? 0;
      const halfSize = 12;
      const apexX = px + halfSize * Math.sin(yaw);
      const apexY = py - halfSize * Math.cos(yaw);
      const leftAngle = yaw + 2.5;
      const rightAngle = yaw - 2.5;
      const baseX1 = px + halfSize * Math.sin(leftAngle);
      const baseY1 = py - halfSize * Math.cos(leftAngle);
      const baseX2 = px + halfSize * Math.sin(rightAngle);
      const baseY2 = py - halfSize * Math.cos(rightAngle);

      ctx.beginPath();
      ctx.moveTo(apexX, apexY);
      ctx.lineTo(baseX1, baseY1);
      ctx.lineTo(baseX2, baseY2);
      ctx.closePath();
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Compass
    ctx.fillStyle = '#cccccc';
    ctx.font = 'bold 14px monospace';
    ctx.textBaseline = 'top';
    ctx.fillText('N', 8, 8);
  }

  if (!open) return null;
  return (
    <div style={S.backdrop} role="dialog" aria-label="World map">
      <div style={S.modal}>
        <div style={S.header}>
          <span style={S.title}>🗺️ World Map</span>
          <button style={S.closeBtn} onClick={() => setOpen(false)} aria-label="Close map">✕</button>
        </div>
        <canvas ref={canvasRef} width={720} height={720} style={S.canvas} />
        <div style={S.legend}>
          {LEGEND.map((entry) => (
            <span key={entry.label} style={S.legendItem}>
              <span style={{ ...S.legendGlyph, color: entry.color }} aria-hidden>{entry.glyph}</span>
              <span>{entry.label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

const S: Record<string, React.CSSProperties> = {
  backdrop: {
    // High z-index so the dim covers minimap/HUD; minimap has implicit
    // z-index:auto so it would otherwise bleed through at this scale.
    position: 'absolute', inset: 0, zIndex: 100,
    background: 'rgba(15, 12, 10, 0.96)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'auto', fontFamily: 'sans-serif',
  },
  modal: {
    background: '#1F1812', color: '#F5E6D0',
    borderRadius: 12, padding: 16,
    maxWidth: 'calc(100vw - 40px)', maxHeight: 'calc(100vh - 40px)',
    boxShadow: '0 12px 60px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(216,148,56,0.20)',
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 16, fontWeight: 600, fontFamily: 'Georgia, "Source Serif", serif', color: '#F5E6D0' },
  closeBtn: {
    width: 28, height: 28, borderRadius: 14,
    background: 'rgba(245,230,208,0.10)', color: '#F5E6D0',
    border: 'none', cursor: 'pointer', fontSize: 14,
  },
  canvas: { width: 'min(80vh, 720px)', height: 'min(80vh, 720px)', borderRadius: 8 },
  legend: { display: 'flex', flexWrap: 'wrap', columnGap: 14, rowGap: 4, fontSize: 11, color: '#C7B299' },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  legendGlyph: { display: 'inline-block', minWidth: 12, textAlign: 'center', fontFamily: 'serif', fontSize: 13, fontWeight: 'bold' },
};
