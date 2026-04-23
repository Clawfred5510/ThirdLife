/**
 * ThirdLife UI design tokens — a single source of truth for panel
 * colors, typography, and spacing. Extracted during the Phase 3.4 UI
 * audit (see docs/improvement-plan-2026-04-23.md).
 *
 * Colors align with design/art/art-bible.md: "Cozy Premium
 * Stylized-Realistic" — warm cream + stone + a single accent.
 */

export const theme = {
  color: {
    /** Warm cream surface — matches the art-bible apartment primary. */
    surface: 'rgba(32, 28, 24, 0.82)',
    surfaceHover: 'rgba(48, 42, 36, 0.9)',
    surfaceBorder: 'rgba(255, 255, 255, 0.12)',

    /** Default text on a dark surface. */
    text: '#f5eee3',
    textMuted: 'rgba(245, 238, 227, 0.66)',
    textDim: 'rgba(245, 238, 227, 0.45)',

    /** Brand accent — used for $AMETA balances and CTAs. */
    accent: '#facc15',
    accentText: '#1a1409',

    /** Semantic states. */
    success: '#4ade80',
    warning: '#fb923c',
    danger: '#ef4444',
    info: '#60a5fa',

    /** Ownership affordances — colorblind-safe pairings. */
    ownedByMe: '#4ade80',       // green — also paired with ✓ icon
    ownedByOther: '#fb923c',    // orange — also paired with ● icon
    unowned: 'rgba(245, 238, 227, 0.5)',
  },
  radius: {
    sm: 4,
    md: 8,
    lg: 12,
  },
  font: {
    family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', system-ui, sans-serif",
    familyMono: "'JetBrains Mono', 'SF Mono', 'Consolas', monospace",
    sizeXs: 10,
    sizeSm: 11,
    sizeBase: 13,
    sizeLg: 15,
    sizeXl: 18,
    weightRegular: 400,
    weightMedium: 500,
    weightBold: 700,
  },
  space: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
  shadow: {
    panel: '0 10px 25px rgba(0, 0, 0, 0.35)',
    focusRing: '0 0 0 2px #facc15',
  },
  motion: {
    /** Returns true if the user has requested reduced motion. */
    prefersReducedMotion(): boolean {
      if (typeof window === 'undefined' || !window.matchMedia) return false;
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    },
  },
} as const;

/** Inline style helpers for common patterns. */
import type { CSSProperties } from 'react';
export const panel: CSSProperties = {
  background: theme.color.surface,
  color: theme.color.text,
  border: `1px solid ${theme.color.surfaceBorder}`,
  borderRadius: theme.radius.md,
  boxShadow: theme.shadow.panel,
  fontFamily: theme.font.family,
  fontSize: theme.font.sizeBase,
};

/** Focus-visible ring applied to any interactive element. */
export const focusRingStyle = `
  *:focus-visible {
    outline: none;
    box-shadow: ${theme.shadow.focusRing};
  }
`;
