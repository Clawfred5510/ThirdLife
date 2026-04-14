import { Server } from 'colyseus';
import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import * as path from 'path';
import { GameRoom } from './rooms/GameRoom';
import studioApi from './api/studio';
import { GAME_NAME } from '@gamestu/shared';

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);

// ── Colyseus game server (WebSocket at /ws) ────────────────────────────────
// The `path: '/ws'` option is forwarded to the ws WebSocket.Server,
// so only WebSocket upgrade requests starting with /ws are accepted.
// HTTP matchmaking requests to /ws/matchmake/... also work because
// Colyseus checks if the URL *contains* "/matchmake".
const gameServer = new Server({
  server: httpServer,
  // @ts-expect-error — 'path' is forwarded to ws.WebSocketServer via WebSocketTransport
  path: '/ws',
});

gameServer.define('game', GameRoom);

// ── Studio API routes ──────────────────────────────────────────────────────
app.use('/api', studioApi);

// ── Serve built client static files ────────────────────────────────────────
// Resolve to packages/client/dist relative to this compiled file's location.
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));

// SPA fallback: serve index.html for any non-API route
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ── Start server ───────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 8080;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log(`🎮 ${GAME_NAME} Standalone Server`);
  console.log(`   HTTP:      http://0.0.0.0:${PORT}`);
  console.log(`   WebSocket: ws://0.0.0.0:${PORT}/ws`);
  console.log(`   Client:    ${clientDist}`);
  console.log('');
});
