import React, { useEffect, useState, useCallback } from 'react';
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

export const CharacterCreator: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);

  // Hydrate from server whenever the local player data shows up / changes
  useEffect(() => {
    const hydrate = () => {
      const me = getLocalPlayer();
      if (me?.appearance) setAppearance(me.appearance);
    };
    hydrate();
    const offAdd = onPlayerAdd((sid) => {
      if (sid === getSessionId()) hydrate();
    });
    const offChange = onPlayerChange((sid) => {
      if (sid === getSessionId()) hydrate();
    });
    return () => { offAdd(); offChange(); };
  }, []);

  // Listen for a global custom event so other components (e.g. GameMenu) can
  // open the creator without wiring in the ref directly.
  useEffect(() => {
    const openHandler = () => setOpen(true);
    window.addEventListener('open-character-creator', openHandler);
    return () => window.removeEventListener('open-character-creator', openHandler);
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
      <button
        style={styles.openBtn}
        onClick={() => setOpen(true)}
        title="Customize character"
      >
        👕 Character
      </button>
    );
  }

  return (
    <div style={styles.overlay} onClick={() => setOpen(false)}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Character Creator</h2>
          <button style={styles.close} onClick={() => setOpen(false)}>×</button>
        </div>

        <Section title="Skin">
          <ColorRow value={appearance.body_color} onChange={(v) => update({ body_color: v })} />
        </Section>

        <Section title="Hat">
          <StyleRow
            styles={HAT_STYLES}
            value={appearance.hat_style}
            onChange={(v) => update({ hat_style: v as HatStyle })}
          />
          {appearance.hat_style !== 'none' && (
            <ColorRow value={appearance.hat_color} onChange={(v) => update({ hat_color: v })} />
          )}
        </Section>

        <Section title="Shirt">
          <StyleRow
            styles={SHIRT_STYLES}
            value={appearance.shirt_style}
            onChange={(v) => update({ shirt_style: v as ShirtStyle })}
          />
          <ColorRow value={appearance.shirt_color} onChange={(v) => update({ shirt_color: v })} />
        </Section>

        <Section title="Pants">
          <StyleRow
            styles={PANTS_STYLES}
            value={appearance.pants_style}
            onChange={(v) => update({ pants_style: v as PantsStyle })}
          />
          <ColorRow value={appearance.pants_color} onChange={(v) => update({ pants_color: v })} />
        </Section>

        <Section title="Shoes">
          <StyleRow
            styles={SHOES_STYLES}
            value={appearance.shoes_style}
            onChange={(v) => update({ shoes_style: v as ShoesStyle })}
          />
          <ColorRow value={appearance.shoes_color} onChange={(v) => update({ shoes_color: v })} />
        </Section>

        <Section title="Accessory">
          <StyleRow
            styles={ACC_STYLES}
            value={appearance.accessory_style}
            onChange={(v) => update({ accessory_style: v as AccessoryStyle })}
          />
          {appearance.accessory_style !== 'none' && (
            <ColorRow value={appearance.accessory_color} onChange={(v) => update({ accessory_color: v })} />
          )}
        </Section>

        <div style={styles.footer}>
          <button
            style={styles.reset}
            onClick={() => {
              setAppearance(DEFAULT_APPEARANCE);
              sendUpdateAppearance(DEFAULT_APPEARANCE);
            }}
          >
            Reset to default
          </button>
          <button style={styles.done} onClick={() => setOpen(false)}>Done</button>
        </div>
      </div>
    </div>
  );
};

// ---- Subcomponents ----

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={styles.section}>
    <div style={styles.sectionLabel}>{title}</div>
    {children}
  </div>
);

const ColorRow: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => (
  <div style={styles.colorRow}>
    {PRESET_COLORS.map((c) => (
      <button
        key={c}
        onClick={() => onChange(c)}
        style={{
          ...styles.swatch,
          background: c,
          outline: value.toLowerCase() === c.toLowerCase() ? '2px solid #8cf' : '1px solid rgba(255,255,255,0.15)',
        }}
        aria-label={c}
      />
    ))}
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={styles.colorPicker}
      title="Custom color"
    />
  </div>
);

const StyleRow: React.FC<{
  styles: readonly string[];
  value: string;
  onChange: (v: string) => void;
}> = ({ styles: opts, value, onChange }) => (
  <div style={styles.styleRow}>
    {opts.map((s) => (
      <button
        key={s}
        onClick={() => onChange(s)}
        style={{
          ...styles.styleBtn,
          background: value === s ? '#2d6cdf' : 'rgba(255,255,255,0.06)',
          borderColor: value === s ? '#4a90d9' : 'rgba(255,255,255,0.12)',
        }}
      >
        {s}
      </button>
    ))}
  </div>
);

// ---- Styles ----

const styles: Record<string, React.CSSProperties> = {
  openBtn: {
    position: 'absolute',
    top: 16,
    right: 260,
    background: 'rgba(12, 14, 24, 0.85)',
    border: '1px solid rgba(255,255,255,0.15)',
    color: '#fff',
    borderRadius: 6,
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: 'sans-serif',
    pointerEvents: 'auto',
    zIndex: 10,
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'auto',
    zIndex: 50,
    fontFamily: 'sans-serif',
  },
  panel: {
    width: 420,
    maxHeight: '85vh',
    overflowY: 'auto',
    background: '#14161f',
    border: '1px solid #2a2e3c',
    borderRadius: 12,
    padding: '18px 22px',
    color: '#e4e4ef',
    boxShadow: '0 20px 48px rgba(0,0,0,0.6)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { margin: 0, fontSize: 18 },
  close: {
    background: 'transparent',
    border: 'none',
    color: '#aaa',
    fontSize: 24,
    cursor: 'pointer',
    padding: '0 4px',
  },
  section: {
    marginBottom: 14,
    paddingBottom: 12,
    borderBottom: '1px solid #23263a',
  },
  sectionLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: '#8b8b9a',
    marginBottom: 8,
  },
  colorRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
    marginTop: 6,
  },
  swatch: {
    width: 22,
    height: 22,
    borderRadius: 4,
    border: 0,
    cursor: 'pointer',
    padding: 0,
  },
  colorPicker: {
    width: 32,
    height: 26,
    background: 'transparent',
    border: '1px dashed rgba(255,255,255,0.2)',
    borderRadius: 4,
    cursor: 'pointer',
    marginLeft: 4,
  },
  styleRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  styleBtn: {
    padding: '5px 10px',
    border: '1px solid',
    borderRadius: 6,
    color: '#fff',
    fontSize: 12,
    textTransform: 'capitalize',
    cursor: 'pointer',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: 14,
    gap: 8,
  },
  reset: {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.15)',
    color: '#aaa',
    borderRadius: 6,
    padding: '6px 12px',
    cursor: 'pointer',
    fontSize: 12,
  },
  done: {
    background: '#2d6cdf',
    border: '1px solid #4a90d9',
    color: '#fff',
    borderRadius: 6,
    padding: '6px 18px',
    cursor: 'pointer',
    fontSize: 13,
  },
};
