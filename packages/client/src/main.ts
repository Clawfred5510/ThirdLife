import { Game } from './game/Game';
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { App } from './ui/App';
import { initFeatures } from '@gamestu/shared';

// Initialise feature flags from Vite environment variables
initFeatures({
  JOBS: import.meta.env.VITE_FEATURE_JOBS === 'true' || import.meta.env.VITE_FEATURE_JOBS === '1',
  NPCS: import.meta.env.VITE_FEATURE_NPCS === 'true' || import.meta.env.VITE_FEATURE_NPCS === '1',
  TUTORIAL: import.meta.env.VITE_FEATURE_TUTORIAL === 'true' || import.meta.env.VITE_FEATURE_TUTORIAL === '1',
  DAY_NIGHT: import.meta.env.VITE_FEATURE_DAY_NIGHT === 'true' || import.meta.env.VITE_FEATURE_DAY_NIGHT === '1',
});

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const game = new Game(canvas);
game.start();

const uiRoot = document.getElementById('ui-root');
if (uiRoot) {
  const root = createRoot(uiRoot);
  root.render(createElement(App));
}
