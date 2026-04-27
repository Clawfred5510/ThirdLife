import React, { useEffect, useRef, useCallback } from 'react';
import { WORLD_HALF } from '@gamestu/shared';
import {
  onPlayerAdd,
  onPlayerRemove,
  onPlayerChange,
  onParcelState,
  onParcelUpdate,
  getSessionId,
  getLocalPlayer,
  PlayerSnapshot,
} from '../../network/Client';
import type { ParcelData } from '@gamestu/shared';

// i18n: compass label is a single character — no localization needed
const SIZE = 150;

// Mirror of buildings.ts STRIDE — keep in sync if STRIDE changes there
const MINIMAP_STRIDE = 48;

// Validated hex color — fallback used when parcel.color is missing or malformed
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const PARCEL_COLOR_FALLBACK = '#4A90D9';

function worldToMinimap(wx: number, wz: number): [number, number] {
  const mx = ((wx + WORLD_HALF) / (WORLD_HALF * 2)) * SIZE;
  const my = ((-wz + WORLD_HALF) / (WORLD_HALF * 2)) * SIZE; // flip z so +Z is canvas-down
  return [mx, my];
}

export const Minimap: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playersRef = useRef<Map<string, PlayerSnapshot>>(new Map());
  const parcelsRef = useRef<Map<number, ParcelData>>(new Map());
  const rafRef = useRef<number>(0);

  // Optimization: only re-sort remotes when count changes
  const lastRemoteCountRef = useRef<number>(0);
  const sortedRemotesRef = useRef<PlayerSnapshot[]>([]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // ── Layer 1: Background ───────────────────────────────────────────────
    ctx.fillStyle = 'rgba(10, 12, 16, 0.78)';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // ── Layer 2: Parcel grid lines ────────────────────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 0.5;
    const step = MINIMAP_STRIDE * 5;
    for (let worldX = -WORLD_HALF; worldX <= WORLD_HALF; worldX += step) {
      const [cx] = worldToMinimap(worldX, 0);
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, SIZE);
      ctx.stroke();
    }
    for (let worldZ = -WORLD_HALF; worldZ <= WORLD_HALF; worldZ += step) {
      const [, cy] = worldToMinimap(0, worldZ);
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(SIZE, cy);
      ctx.stroke();
    }

    // ── Layer 3: Claimed parcel fills ─────────────────────────────────────
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = 0.7;
    for (const parcel of parcelsRef.current.values()) {
      if (!parcel.owner_id) continue;
      const wx = parcel.grid_x * MINIMAP_STRIDE - WORLD_HALF + 20;
      const wz = parcel.grid_y * MINIMAP_STRIDE - WORLD_HALF + 20;
      const [cx, cy] = worldToMinimap(wx, wz);
      ctx.fillStyle = HEX_COLOR_RE.test(parcel.color) ? parcel.color : PARCEL_COLOR_FALLBACK;
      ctx.fillRect(cx, cy, 2, 2);
    }
    ctx.globalAlpha = prevAlpha;

    // ── Layer 4: Rocket landmark (always at canvas center) ────────────────
    ctx.fillStyle = '#FFFFFF';
    // Body: 3×8 rectangle centered at (75,75), spanning y 71→79
    ctx.fillRect(73.5, 71, 3, 8);
    // Cap: triangle with apex at (75, 67), base from (71.5, 71) to (78.5, 71)
    ctx.beginPath();
    ctx.moveTo(75, 67);
    ctx.lineTo(71.5, 71);
    ctx.lineTo(78.5, 71);
    ctx.closePath();
    ctx.fill();

    // ── Layer 5: Remote players ───────────────────────────────────────────
    const myId = getSessionId();
    const localPlayer = getLocalPlayer();

    const allRemotes: PlayerSnapshot[] = [];
    for (const [sessionId, player] of playersRef.current) {
      if (sessionId !== myId) allRemotes.push(player);
    }

    const remoteCount = allRemotes.length;
    let rendered = sortedRemotesRef.current;
    if (remoteCount !== lastRemoteCountRef.current) {
      // Re-sort only when count changes — sort by distance to local player
      if (localPlayer && remoteCount > 20) {
        const lx = localPlayer.x;
        const lz = localPlayer.z;
        allRemotes.sort((a, b) => {
          const da = (a.x - lx) ** 2 + (a.z - lz) ** 2;
          const db = (b.x - lx) ** 2 + (b.z - lz) ** 2;
          return da - db;
        });
        rendered = allRemotes.slice(0, 20);
      } else {
        rendered = allRemotes;
      }
      sortedRemotesRef.current = rendered;
      lastRemoteCountRef.current = remoteCount;
    }

    ctx.fillStyle = '#FF6B6B';
    for (const player of rendered) {
      const [cx, cy] = worldToMinimap(player.x, player.z);
      const px = Math.max(1, Math.min(SIZE - 1, cx));
      const py = Math.max(1, Math.min(SIZE - 1, cy));
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Layer 6: Local player ─────────────────────────────────────────────
    if (localPlayer) {
      const [mx, my] = worldToMinimap(localPlayer.x, localPlayer.z);
      // rotation=0 means forward = +Z in world. The z-flip in worldToMinimap
      // already inverts the y axis, so apex = my - cos(rotation) maps that
      // forward vector onto canvas-up correctly. (Originally had a +PI
      // here which double-inverted and pointed the arrow away from heading.)
      const canvasAngle = localPlayer.rotation;
      const halfSize = 5;
      const apexX = mx + halfSize * Math.sin(canvasAngle);
      const apexY = my - halfSize * Math.cos(canvasAngle);
      const leftAngle = canvasAngle + 2.5;
      const rightAngle = canvasAngle - 2.5;
      const baseX1 = mx + halfSize * Math.sin(leftAngle);
      const baseY1 = my - halfSize * Math.cos(leftAngle);
      const baseX2 = mx + halfSize * Math.sin(rightAngle);
      const baseY2 = my - halfSize * Math.cos(rightAngle);

      ctx.beginPath();
      ctx.moveTo(apexX, apexY);
      ctx.lineTo(baseX1, baseY1);
      ctx.lineTo(baseX2, baseY2);
      ctx.closePath();
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // ── Layer 7: N compass label ──────────────────────────────────────────
    ctx.fillStyle = '#CCCCCC';
    ctx.font = 'bold 8px monospace';
    ctx.textBaseline = 'top';
    ctx.fillText('N', 4, 11);
  }, []);

  useEffect(() => {
    // Player subscriptions
    const handlePlayerAdd = (sessionId: string, player: PlayerSnapshot) => {
      playersRef.current.set(sessionId, player);
    };
    const handlePlayerRemove = (sessionId: string) => {
      playersRef.current.delete(sessionId);
    };
    const handlePlayerChange = (sessionId: string, player: PlayerSnapshot) => {
      playersRef.current.set(sessionId, player);
    };

    // Parcel subscriptions
    const handleParcelState = (parcels: ParcelData[]) => {
      parcelsRef.current.clear();
      for (const p of parcels) {
        parcelsRef.current.set(p.id, p);
      }
    };
    const handleParcelUpdate = (update: Partial<ParcelData> & { owner_name?: string; error?: string }) => {
      if (update.id === undefined) return;
      const existing = parcelsRef.current.get(update.id);
      if (existing) {
        // Merge partial update into stored parcel
        parcelsRef.current.set(update.id, { ...existing, ...update });
      } else if (update.grid_x !== undefined && update.grid_y !== undefined) {
        // New parcel we haven't seen before — store it if we have enough data
        parcelsRef.current.set(update.id, update as ParcelData);
      }
    };

    const unsubAdd = onPlayerAdd(handlePlayerAdd);
    const unsubRemove = onPlayerRemove(handlePlayerRemove);
    const unsubChange = onPlayerChange(handlePlayerChange);
    const unsubParcelState = onParcelState(handleParcelState);
    const unsubParcelUpdate = onParcelUpdate(handleParcelUpdate);

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
      unsubAdd();
      unsubRemove();
      unsubChange();
      unsubParcelState();
      unsubParcelUpdate();
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
