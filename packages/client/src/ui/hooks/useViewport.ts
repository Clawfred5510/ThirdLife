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
  isMobile: boolean;
  isPortrait: boolean;
}

const MOBILE_MAX_WIDTH = 600;

function snapshot(): Viewport {
  if (typeof window === 'undefined') {
    return { width: 1280, height: 720, isMobile: false, isPortrait: false };
  }
  const w = window.innerWidth;
  const h = window.innerHeight;
  return {
    width: w,
    height: h,
    isMobile: w < MOBILE_MAX_WIDTH,
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
