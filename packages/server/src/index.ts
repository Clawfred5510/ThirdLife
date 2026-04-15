import { Server } from 'colyseus';
import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import { GameRoom } from './rooms/GameRoom';
import studioApi from './api/studio';
import { DEFAULT_SERVER_PORT, GAME_NAME, features, initFeatures } from '@gamestu/shared';

// Initialise feature flags from environment variables
initFeatures({
  JOBS: process.env.FEATURE_JOBS === 'true' || process.env.FEATURE_JOBS === '1',
  NPCS: process.env.FEATURE_NPCS === 'true' || process.env.FEATURE_NPCS === '1',
  TUTORIAL: process.env.FEATURE_TUTORIAL === 'true' || process.env.FEATURE_TUTORIAL === '1',
  DAY_NIGHT: process.env.FEATURE_DAY_NIGHT === 'true' || process.env.FEATURE_DAY_NIGHT === '1',
});

console.log(`[features] JOBS=${features.JOBS} NPCS=${features.NPCS} TUTORIAL=${features.TUTORIAL} DAY_NIGHT=${features.DAY_NIGHT}`);

const app = express();
app.use(cors());
app.use(express.json());
const httpServer = createServer(app);

const gameServer = new Server({
  server: httpServer,
});

gameServer.define('game', GameRoom);

app.get('/', (_req, res) => {
  res.json({ name: GAME_NAME, status: 'running' });
});

app.use('/api', studioApi);

const port = Number(process.env.PORT) || DEFAULT_SERVER_PORT;
httpServer.listen(port, () => {
  console.log(`${GAME_NAME} server listening on http://localhost:${port}`);
});
