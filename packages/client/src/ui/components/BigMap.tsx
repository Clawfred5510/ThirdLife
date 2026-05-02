import React, { useEffect, useRef, useState } from 'react';
import {
  WORLD_HALF, GRID_COLS, GRID_ROWS, ZONE_COLORS, LANDMARKS,
  zoneForGrid, isPremiumParcel,
} from '@gamestu/shared';
import type { ParcelData } from '@gamestu/shared';
import { apiGet } from '../../network/api';
import {
  onPlayerAdd, onPlayerRemove, onPlayerChange,
  getSessionId, getLocalPlayer, PlayerSnapshot,
} from '../../network/Client';

/**
 * Full-screen map opened by clicking the minimap. Renders the same
 * visual layers (zones, landmarks, premium parcels, claimed parcels)
 * scaled up, plus a cursor-pointer style indicator at the local
 * player's position with their facing direction.
 */

const LANDMARK_GLYPH: Record<string, string> = {
  town_hall: '★', plaza: '◆', monument: '♦', gate: '⌂', park: '✿', harbor: '⚓',
};

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

    ctx.fillStyle = '#0c0e18';
    ctx.fillRect(0, 0, W, H);

    // Zones
    ctx.globalAlpha = 0.4;
    for (let gx = 0; gx < GRID_COLS; gx++) {
      for (let gy = 0; gy < GRID_ROWS; gy++) {
        ctx.fillStyle = ZONE_COLORS[zoneForGrid(gx, gy)];
        ctx.fillRect(gx * cellW, gy * cellH, cellW, cellH);
      }
    }
    ctx.globalAlpha = 1;

    // Premium gold borders
    ctx.strokeStyle = '#FFD24A';
    ctx.lineWidth = 1;
    for (let gx = 0; gx < GRID_COLS; gx++) {
      for (let gy = 0; gy < GRID_ROWS; gy++) {
        if (!isPremiumParcel(gx * GRID_COLS + gy)) continue;
        ctx.strokeRect(gx * cellW + 0.5, gy * cellH + 0.5, cellW - 1, cellH - 1);
      }
    }

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

    // Local player — cursor-pointer style arrow with name label
    const me = getLocalPlayer();
    if (me) {
      const [px, py] = worldToCanvas(me.x, me.z, W, H);
      drawCursorPointer(ctx, px, py, me.rotation ?? 0);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('You', px, py - 18);
      ctx.textAlign = 'start';
    }

    // Compass
    ctx.fillStyle = '#cccccc';
    ctx.font = 'bold 14px monospace';
    ctx.textBaseline = 'top';
    ctx.fillText('N', 8, 8);
  }

  /** Draw a classic mouse-cursor-style arrow at (px,py), rotated to
   *  match the player's facing yaw. Filled white with a black outline
   *  so it reads on any background. */
  function drawCursorPointer(ctx: CanvasRenderingContext2D, px: number, py: number, yaw: number) {
    ctx.save();
    ctx.translate(px, py);
    // Player rotation=0 means forward = +Z. With the canvas Z-flipped,
    // forward becomes canvas-up. Rotate the cursor so its tip points
    // along the player's heading.
    ctx.rotate(yaw);
    // Cursor shape — sharp tip up and to the left of origin, body
    // extending down and right (classic OS pointer silhouette).
    ctx.beginPath();
    ctx.moveTo(0, -14);          // tip
    ctx.lineTo(8, 4);            // shoulder right
    ctx.lineTo(2, 4);            // tail base inner
    ctx.lineTo(6, 13);           // tail tip
    ctx.lineTo(2, 15);           // tail tip outer
    ctx.lineTo(-2, 7);           // tail base outer
    ctx.lineTo(-6, 11);          // shoulder left
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.restore();
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
          {(Object.keys(ZONE_COLORS) as Array<keyof typeof ZONE_COLORS>).map((z) => (
            <span key={z} style={S.legendItem}>
              <span style={{ ...S.legendSwatch, background: ZONE_COLORS[z] }} />
              {z}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

const S: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'absolute', inset: 0, zIndex: 30,
    background: 'rgba(0,0,0,0.65)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'auto', fontFamily: 'sans-serif',
  },
  modal: {
    background: '#0c0e18', color: '#e4e4ef',
    borderRadius: 12, padding: 16,
    maxWidth: 'calc(100vw - 40px)', maxHeight: 'calc(100vh - 40px)',
    boxShadow: '0 12px 60px rgba(0,0,0,0.7)',
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 14, fontWeight: 600 },
  closeBtn: {
    width: 28, height: 28, borderRadius: 14,
    background: 'rgba(255,255,255,0.06)', color: '#e4e4ef',
    border: 'none', cursor: 'pointer', fontSize: 14,
  },
  canvas: { width: 'min(80vh, 720px)', height: 'min(80vh, 720px)', borderRadius: 8 },
  legend: { display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 11, color: '#8b8b9a' },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 4, textTransform: 'capitalize' },
  legendSwatch: { display: 'inline-block', width: 10, height: 10, borderRadius: 2 },
};
