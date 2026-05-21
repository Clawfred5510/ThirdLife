import { useEffect, useState } from 'react';

/**
 * Tracks the current viewport size + a boolean for "mobile" (< 600px wide
 * or in portrait orientation). UI components use this to swap between
 * desktop and mobile layouts inline without a separate stylesheet.
 *
 * Re-renders on window resize and orientationchange. Returns SSR-safe
 * defaults (desktop) on the first render to avoid hydration mismatches.
 */
export interface Viewport {
  width: number;
  height: number;
  /** Triggers compact UI (collapsed HUD, icon-only resource bar, etc.).
   *  True for both narrow phones AND short landscape viewports (iPad lndsc). */
  isMobile: boolean;
  /** True only for narrow phone viewports — separate so the in-game phone
   *  widget can go full-screen on portrait phones without doing the same
   *  on iPad landscape (where it should stay a corner card). */
  isNarrow: boolean;
  isPortrait: boolean;
}

// Phone-portrait viewports (width < 600) ALWAYS get the mobile layout.
// Wide-but-short viewports (iPad landscape, foldables, browser dev-tools
// docked, etc.) also get mobile — desktop UI assumes ~720px+ vertical
// real estate, so the 580px-tall phone bezel clips on a 614px iPad.
// 760 is the practical floor: above that, the desktop chrome (HUD strip,
// wallet at top:120, chat at top:160) fits.
const MOBILE_MAX_WIDTH = 600;
const MOBILE_MAX_HEIGHT = 760;

function snapshot(): Viewport {
  if (typeof window === 'undefined') {
    return { width: 1280, height: 720, isMobile: false, isNarrow: false, isPortrait: false };
  }
  const w = window.innerWidth;
  const h = window.innerHeight;
  return {
    width: w,
    height: h,
    isMobile: w < MOBILE_MAX_WIDTH || h < MOBILE_MAX_HEIGHT,
    isNarrow: w < MOBILE_MAX_WIDTH,
    isPortrait: h > w,
  };
}

export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() => snapshot());

  useEffect(() => {
    const onResize = () => setVp(snapshot());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  return vp;
}
