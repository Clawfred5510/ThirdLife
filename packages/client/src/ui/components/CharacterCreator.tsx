import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Appearance,
  DEFAULT_APPEARANCE,
  HatStyle,
  ShirtStyle,
  PantsStyle,
  ShoesStyle,
  AccessoryStyle,
} from '@gamestu/shared';
import {
  sendUpdateAppearance,
  onPlayerChange,
  onPlayerAdd,
  getSessionId,
  getLocalPlayer,
} from '../../network/Client';
import { Engine, Scene, ArcRotateCamera, HemisphericLight, Vector3, Color4, Color3 } from '@babylonjs/core';
import { buildAvatar, applyAppearance, disposeAvatar, Avatar } from '../../game/entities/avatar';

const PRESET_COLORS = [
  '#f4d9c6', '#eac39e', '#c4916d', '#8a5a3b', '#523524',
  '#ffffff', '#c0c0c0', '#808080', '#404040', '#111111',
  '#e53935', '#ff9800', '#ffeb3b', '#8bc34a', '#009688',
  '#2196f3', '#3f51b5', '#9c27b0', '#e91e63', '#795548',
];

const HAT_STYLES: HatStyle[] = ['none', 'cap', 'tophat', 'beanie'];
const SHIRT_STYLES: ShirtStyle[] = ['basic', 'stripe', 'vest'];
const PANTS_STYLES: PantsStyle[] = ['basic', 'shorts'];
const SHOES_STYLES: ShoesStyle[] = ['basic', 'boots'];
const ACC_STYLES: AccessoryStyle[] = ['none', 'chain', 'sunglasses', 'bowtie'];

// ---- 3D Preview Component ----

const AvatarPreview: React.FC<{ appearance: Appearance }> = ({ appearance }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const avatarRef = useRef<Avatar | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.12, 0.13, 0.18, 1);

    const cam = new ArcRotateCamera('previewCam', Math.PI * 0.8, Math.PI / 2.2, 4, new Vector3(0, 1.0, 0), scene);
    cam.attachControl(canvas, true);
    cam.lowerRadiusLimit = 2;
    cam.upperRadiusLimit = 8;
    cam.panningSensibility = 0;
    cam.wheelPrecision = 30;

    const light = new HemisphericLight('previewLight', new Vector3(0.3, 1, 0.2), scene);
    light.intensity = 0.9;
    light.specular = Color3.Black();

    const avatar = buildAvatar(scene, 'preview', appearance);
    avatar.root.position.set(0, 0, 0);
    avatarRef.current = avatar;

    engineRef.current = engine;
    sceneRef.current = scene;

    engine.runRenderLoop(() => scene.render());

    const resize = () => engine.resize();
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      engine.stopRenderLoop();
      scene.dispose();
      engine.dispose();
      engineRef.current = null;
      sceneRef.current = null;
      avatarRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (avatarRef.current && sceneRef.current) {
      applyAppearance(sceneRef.current, avatarRef.current, appearance);
    }
  }, [appearance]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: 280,
        borderRadius: 10,
        border: '1px solid #2a2e3c',
        cursor: 'grab',
        display: 'block',
      }}
    />
  );
};

// ---- Main Component ----

export const CharacterCreator: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);

  useEffect(() => {
    const hydrate = () => {
      const me = getLocalPlayer();
      if (me?.appearance) setAppearance(me.appearance);
    };
    hydrate();
    const offAdd = onPlayerAdd((sid) => { if (sid === getSessionId()) hydrate(); });
    const offChange = onPlayerChange((sid) => { if (sid === getSessionId()) hydrate(); });
    return () => { offAdd(); offChange(); };
  }, []);

  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener('open-character-creator', h);
    return () => window.removeEventListener('open-character-creator', h);
  }, []);

  const update = useCallback((partial: Partial<Appearance>) => {
    setAppearance((prev) => {
      const next = { ...prev, ...partial };
      sendUpdateAppearance(partial);
      return next;
    });
  }, []);

  if (!open) {
    return (
      <button style={S.openBtn} onClick={() => setOpen(true)} title="Customize character">
        👕 Character
      </button>
    );
  }

  return (
    <div style={S.overlay} onClick={() => setOpen(false)}>
      <div style={S.panel} onClick={(e) => e.stopPropagation()}>
        <div style={S.header}>
          <h2 style={S.title}>Character Creator</h2>
          <button style={S.close} onClick={() => setOpen(false)}>×</button>
        </div>

        {/* Live 3D preview — drag to spin */}
        <AvatarPreview appearance={appearance} />
        <p style={S.hint}>Drag to rotate • Scroll to zoom</p>

        <div style={S.scrollBody}>
          <Slot title="Skin">
            <ColorRow value={appearance.body_color} onChange={(v) => update({ body_color: v })} />
          </Slot>

          <Slot title="Hat">
            <StyleRow options={HAT_STYLES} value={appearance.hat_style} onChange={(v) => update({ hat_style: v as HatStyle })} />
            {appearance.hat_style !== 'none' && <ColorRow value={appearance.hat_color} onChange={(v) => update({ hat_color: v })} />}
          </Slot>

          <Slot title="Shirt">
            <StyleRow options={SHIRT_STYLES} value={appearance.shirt_style} onChange={(v) => update({ shirt_style: v as ShirtStyle })} />
            <ColorRow value={appearance.shirt_color} onChange={(v) => update({ shirt_color: v })} />
          </Slot>

          <Slot title="Pants">
            <StyleRow options={PANTS_STYLES} value={appearance.pants_style} onChange={(v) => update({ pants_style: v as PantsStyle })} />
            <ColorRow value={appearance.pants_color} onChange={(v) => update({ pants_color: v })} />
          </Slot>

          <Slot title="Shoes">
            <StyleRow options={SHOES_STYLES} value={appearance.shoes_style} onChange={(v) => update({ shoes_style: v as ShoesStyle })} />
            <ColorRow value={appearance.shoes_color} onChange={(v) => update({ shoes_color: v })} />
          </Slot>

          <Slot title="Accessory">
            <StyleRow options={ACC_STYLES} value={appearance.accessory_style} onChange={(v) => update({ accessory_style: v as AccessoryStyle })} />
            {appearance.accessory_style !== 'none' && <ColorRow value={appearance.accessory_color} onChange={(v) => update({ accessory_color: v })} />}
          </Slot>
        </div>

        <div style={S.footer}>
          <button style={S.reset} onClick={() => { setAppearance(DEFAULT_APPEARANCE); sendUpdateAppearance(DEFAULT_APPEARANCE); }}>
            Reset
          </button>
          <button style={S.done} onClick={() => setOpen(false)}>Done</button>
        </div>
      </div>
    </div>
  );
};

// ---- Sub-components ----

const Slot: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={S.section}>
    <div style={S.sectionLabel}>{title}</div>
    {children}
  </div>
);

const ColorRow: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => (
  <div style={S.colorRow}>
    {PRESET_COLORS.map((c) => (
      <button
        key={c}
        onClick={() => onChange(c)}
        style={{
          ...S.swatch,
          background: c,
          outline: value.toLowerCase() === c.toLowerCase() ? '2px solid #8cf' : '1px solid rgba(255,255,255,0.12)',
          outlineOffset: '1px',
        }}
        aria-label={c}
      />
    ))}
    <input type="color" value={value} onChange={(e) => onChange(e.target.value)} style={S.colorPicker} title="Custom" />
  </div>
);

const StyleRow: React.FC<{ options: readonly string[]; value: string; onChange: (v: string) => void }> = ({ options, value, onChange }) => (
  <div style={S.styleRow}>
    {options.map((s) => (
      <button
        key={s}
        onClick={() => onChange(s)}
        style={{
          ...S.styleBtn,
          background: value === s ? '#2d6cdf' : 'rgba(255,255,255,0.06)',
          borderColor: value === s ? '#4a90d9' : 'rgba(255,255,255,0.1)',
        }}
      >
        {s}
      </button>
    ))}
  </div>
);

// ---- Styles ----

const S: Record<string, React.CSSProperties> = {
  openBtn: {
    position: 'absolute', top: 16, right: 260,
    background: 'rgba(12,14,24,0.85)', border: '1px solid rgba(255,255,255,0.15)',
    color: '#fff', borderRadius: 8, padding: '8px 14px',
    cursor: 'pointer', fontSize: 13, fontFamily: 'sans-serif',
    pointerEvents: 'auto', zIndex: 10,
  },
  overlay: {
    position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'auto', zIndex: 50, fontFamily: 'sans-serif',
  },
  panel: {
    width: 440, maxHeight: '92vh', display: 'flex', flexDirection: 'column' as const,
    background: '#13151e', border: '1px solid #2a2e3c', borderRadius: 14,
    padding: '18px 20px 14px', color: '#e4e4ef',
    boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { margin: 0, fontSize: 18, fontWeight: 600 },
  close: { background: 'transparent', border: 'none', color: '#aaa', fontSize: 24, cursor: 'pointer' },
  hint: { textAlign: 'center' as const, fontSize: 11, color: '#6b6b7a', margin: '6px 0 10px', letterSpacing: '0.03em' },
  scrollBody: { flex: 1, overflowY: 'auto' as const, paddingRight: 4 },
  section: { marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid #23263a' },
  sectionLabel: { fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: '#8b8b9a', marginBottom: 6 },
  colorRow: { display: 'flex', flexWrap: 'wrap' as const, gap: 5, alignItems: 'center', marginTop: 4 },
  swatch: { width: 24, height: 24, borderRadius: 5, border: 0, cursor: 'pointer', padding: 0, transition: 'transform 0.1s', },
  colorPicker: { width: 30, height: 28, background: 'transparent', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: 5, cursor: 'pointer', marginLeft: 4 },
  styleRow: { display: 'flex', flexWrap: 'wrap' as const, gap: 5, marginBottom: 6 },
  styleBtn: { padding: '5px 11px', border: '1px solid', borderRadius: 7, color: '#fff', fontSize: 12, textTransform: 'capitalize' as const, cursor: 'pointer', transition: 'background 0.15s' },
  footer: { display: 'flex', justifyContent: 'space-between', marginTop: 12, gap: 8 },
  reset: { background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: '#aaa', borderRadius: 7, padding: '6px 14px', cursor: 'pointer', fontSize: 12 },
  done: { background: '#2d6cdf', border: '1px solid #4a90d9', color: '#fff', borderRadius: 7, padding: '6px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 500 },
};
