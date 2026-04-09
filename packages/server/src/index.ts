import { Server } from 'colyseus';
import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import { GameRoom } from './rooms/GameRoom';
import studioApi from './api/studio';
import { DEFAULT_SERVER_PORT, GAME_NAME } from '@gamestu/shared';

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
