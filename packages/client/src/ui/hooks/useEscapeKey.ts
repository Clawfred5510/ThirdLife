import { useEffect } from 'react';

/**
 * Calls `onEscape` when the user presses Escape, except when they're
 * typing in an INPUT or TEXTAREA. Pass `enabled = false` to disable
 * the listener (e.g. when a modal is closed).
 */
export function useEscapeKey(onEscape: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, onEscape]);
}
