import { Game } from './game/Game';
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { Boot } from './ui/Boot';
import { initFeatures } from '@gamestu/shared';

// Belt-and-suspenders pinch-zoom block. The viewport meta tag with
// user-scalable=no covers modern browsers, but a few iOS Safari versions
// ignore it and let users pinch into a half-zoomed state with no way back.
// Killing gesture events at the window level prevents that. Double-tap
// zoom is suppressed by `touch-action: none` on body in index.html.
for (const evt of ['gesturestart', 'gesturechange', 'gestureend'] as const) {
  window.addEventListener(evt, (e) => e.preventDefault(), { passive: false });
}

// Initialise feature flags from Vite environment variables
initFeatures({
  JOBS: import.meta.env.VITE_FEATURE_JOBS === 'true' || import.meta.env.VITE_FEATURE_JOBS === '1',
  NPCS: import.meta.env.VITE_FEATURE_NPCS === 'true' || import.meta.env.VITE_FEATURE_NPCS === '1',
  TUTORIAL: import.meta.env.VITE_FEATURE_TUTORIAL === 'true' || import.meta.env.VITE_FEATURE_TUTORIAL === '1',
  DAY_NIGHT: import.meta.env.VITE_FEATURE_DAY_NIGHT === 'true' || import.meta.env.VITE_FEATURE_DAY_NIGHT === '1',
});

// The game is NOT started on load anymore. The Boot flow gates entry behind
// the site password (if enabled) → Play Game → wallet connect → loading
// curtain, and only then starts Babylon + connects to the server. We build the
// Game lazily the first time the loading phase asks for it, so the earlier
// screens sit over a clean, idle black canvas.
let game: Game | null = null;
function startGame(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (!game) game = new Game(canvas);
  // Game.start() resolves once the scene is render-ready (and connected, or
  // fell back to offline). The Boot loading screen awaits this.
  return game.start();
}

const uiRoot = document.getElementById('ui-root');
if (uiRoot) {
  const root = createRoot(uiRoot);
  root.render(createElement(Boot, { startGame }));
}
