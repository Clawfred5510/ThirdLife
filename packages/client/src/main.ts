import { Game } from './game/Game';
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { App } from './ui/App';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const game = new Game(canvas);
game.start();

const uiRoot = document.getElementById('ui-root');
if (uiRoot) {
  const root = createRoot(uiRoot);
  root.render(createElement(App));
}
