import { Server } from 'colyseus';
import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import { GameRoom } from './rooms/GameRoom';
import studioApi from './api/studio';
import adminApi from './api/admin';
import agentApi from './api/agent-api';
import authApi from './api/auth';
import { GAME_NAME, features, initFeatures } from '@gamestu/shared';
import { config } from './config';
import { getAllParcels, getAllPlayers } from './db';

initFeatures(config.features);

console.log(
  `[features] JOBS=${features.JOBS} NPCS=${features.NPCS} TUTORIAL=${features.TUTORIAL} DAY_NIGHT=${features.DAY_NIGHT}`
);

const app = express();
app.use(cors({ origin: config.clientOrigin === '*' ? true : config.clientOrigin }));
app.use(express.json());
const httpServer = createServer(app);

const gameServer = new Server({
  server: httpServer,
});

gameServer.define('game', GameRoom);

app.get('/', (_req, res) => {
  res.json({ name: GAME_NAME, status: 'running' });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    features: config.features,
  });
});

app.get('/metrics', (_req, res) => {
  const parcels = getAllParcels();
  const players = getAllPlayers();
  res.json({
    status: 'ok',
    uptime_seconds: process.uptime(),
    players_registered: players.length,
    parcels_total: parcels.length,
    parcels_claimed: parcels.filter((p) => !!p.owner_id).length,
    parcels_with_business: parcels.filter((p) => !!p.business_name).length,
  });
});

app.use('/admin', adminApi);
app.use('/api/v1/auth', authApi);
app.use('/api/v1', agentApi);
app.use('/api', studioApi);

httpServer.listen(config.port, config.host, () => {
  console.log(
    `${GAME_NAME} server listening on http://${config.host}:${config.port} (origin=${config.clientOrigin})`
  );
});
