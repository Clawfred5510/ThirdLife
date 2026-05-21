import React, { useEffect, useRef, useState } from 'react';

/**
 * On-screen virtual joystick for mobile / touch devices.
 *
 * Renders only when the primary pointer is coarse (touchscreen) AND
 * the device reports touch support. Hidden on desktop with a mouse
 * even if the screen has touch hardware (a Surface or the like) — the
 * mouse-wielder doesn't need a joystick.
 *
 * The joystick base is fixed at the bottom-left. On pointerdown the
 * thumb anchors to the touch point and tracks pointermove until the
 * pointer leaves or releases. The thumb's offset from the base center
 * (normalised to [-1..1]) is converted to four directional booleans
 * + a sprint flag (thumb pushed past 80% of the base radius). The
 * state is pushed into MainScene via window.__tlSetVirtualInput.
 *
 * Camera rotation continues to work everywhere outside the joystick
 * footprint — pointer-events:none on the wrapper, pointer-events:auto
 * only on the inner base circle.
 */

const BASE_RADIUS = 56;        // px — radius of the visible base circle
const THUMB_RADIUS = 26;       // px — radius of the inner thumb
const DIR_THRESHOLD = 0.30;    // 30% of base radius before a direction triggers
const SPRINT_THRESHOLD = 0.80; // thumb past 80% of base radius = sprint

interface VirtualInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
}
const ZERO: VirtualInput = { forward: false, backward: false, left: false, right: false, sprint: false };

function isTouchPrimary(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const touchPoints = navigator.maxTouchPoints ?? 0;
  return coarse && touchPoints > 0;
}

function pushVirtual(state: VirtualInput): void {
  const fn = (window as unknown as { __tlSetVirtualInput?: (s: VirtualInput) => void }).__tlSetVirtualInput;
  if (fn) fn(state);
}

export const Joystick: React.FC = () => {
  const [enabled, setEnabled] = useState<boolean>(() => isTouchPrimary());
  const [phoneOpen, setPhoneOpen] = useState(false);
  const baseRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<number | null>(null);
  const stateRef = useRef<VirtualInput>({ ...ZERO });

  // Re-evaluate touch capability on resize / device-orientation change —
  // a docked phone with a Bluetooth keyboard might want the joystick
  // hidden, etc.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(pointer: coarse)');
    const onChange = () => setEnabled(isTouchPrimary());
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  // Hide the joystick while the phone is open — the phone bezel covers
  // its hit area anyway and keeping it active means stray input.
  useEffect(() => {
    const onToggle = (e: Event) => {
      const d = (e as CustomEvent<{ open: boolean }>).detail;
      setPhoneOpen(!!d?.open);
    };
    window.addEventListener('tl-phone-toggle', onToggle);
    return () => window.removeEventListener('tl-phone-toggle', onToggle);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const base = baseRef.current;
    const thumb = thumbRef.current;
    if (!base || !thumb) return;

    const setThumb = (dx: number, dy: number) => {
      thumb.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const reset = () => {
      activeIdRef.current = null;
      setThumb(0, 0);
      if (stateRef.current.forward || stateRef.current.backward || stateRef.current.left || stateRef.current.right || stateRef.current.sprint) {
        stateRef.current = { ...ZERO };
        pushVirtual(stateRef.current);
      }
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      if (activeIdRef.current !== null) return;
      activeIdRef.current = e.pointerId;
      base.setPointerCapture(e.pointerId);
      apply(e);
      e.preventDefault();
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== activeIdRef.current) return;
      apply(e);
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== activeIdRef.current) return;
      try { base.releasePointerCapture(e.pointerId); } catch { /* may already be released */ }
      reset();
    };

    const apply = (e: PointerEvent) => {
      const r = base.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > BASE_RADIUS) {
        const k = BASE_RADIUS / dist;
        dx *= k; dy *= k;
      }
      setThumb(dx, dy);

      const nx = dx / BASE_RADIUS;
      const ny = dy / BASE_RADIUS;
      const next: VirtualInput = {
        forward:  ny < -DIR_THRESHOLD,
        backward: ny >  DIR_THRESHOLD,
        left:     nx < -DIR_THRESHOLD,
        right:    nx >  DIR_THRESHOLD,
        sprint:   Math.hypot(nx, ny) > SPRINT_THRESHOLD,
      };
      const cur = stateRef.current;
      if (next.forward !== cur.forward || next.backward !== cur.backward || next.left !== cur.left || next.right !== cur.right || next.sprint !== cur.sprint) {
        stateRef.current = next;
        pushVirtual(next);
      }
    };

    base.addEventListener('pointerdown', onDown);
    base.addEventListener('pointermove', onMove);
    base.addEventListener('pointerup', onUp);
    base.addEventListener('pointercancel', onUp);
    base.addEventListener('lostpointercapture', () => reset());
    return () => {
      base.removeEventListener('pointerdown', onDown);
      base.removeEventListener('pointermove', onMove);
      base.removeEventListener('pointerup', onUp);
      base.removeEventListener('pointercancel', onUp);
      reset();
    };
  }, [enabled]);

  if (!enabled || phoneOpen) return null;

  return (
    <div style={S.wrapper} aria-hidden>
      <div ref={baseRef} style={S.base}>
        <div ref={thumbRef} style={S.thumb} />
      </div>
    </div>
  );
};

const S: Record<string, React.CSSProperties> = {
  // Wrapper is full-screen + non-interactive so movement around the
  // base still propagates to the canvas (camera rotation gestures).
  wrapper: {
    position: 'absolute', inset: 0, zIndex: 14,
    pointerEvents: 'none',
    touchAction: 'none',
  },
  base: {
    position: 'absolute',
    left: 24,
    bottom: 24,
    width: BASE_RADIUS * 2,
    height: BASE_RADIUS * 2,
    borderRadius: BASE_RADIUS,
    background: 'rgba(31, 24, 18, 0.45)',
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: 'rgba(216, 148, 56, 0.5)',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(245, 230, 208, 0.06)',
    pointerEvents: 'auto',
    touchAction: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    width: THUMB_RADIUS * 2,
    height: THUMB_RADIUS * 2,
    borderRadius: THUMB_RADIUS,
    background: 'rgba(216, 148, 56, 0.85)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgba(245, 230, 208, 0.8)',
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.15)',
    transform: 'translate(0, 0)',
    transition: 'background-color 100ms',
    pointerEvents: 'none',
  },
};
