import { Server, matchMaker } from 'colyseus';
import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import { GameRoom } from './rooms/GameRoom';
import studioApi from './api/studio';
import adminApi from './api/admin';
import agentApi from './api/agent-api';
import authApi from './api/auth';
import siteGateApi from './api/site-gate';
import { GAME_NAME, features, initFeatures } from '@gamestu/shared';
import { config } from './config';
import { getAllParcels, getAllPlayers, maybeRunWipeAndVoucherize } from './db';

initFeatures(config.features);

// Process-wide error capture. Without these, an unhandled rejection in any
// async tick handler crashes the worker with a vague "Promise rejection"
// stack and no per-incident tag — making post-mortem in Railway logs hard.
// These keep the process alive but ensure the failure is loud + greppable.
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection:', reason instanceof Error ? reason.stack ?? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException:', err.stack ?? err.message);
});

console.log(
  `[features] JOBS=${features.JOBS} NPCS=${features.NPCS} TUTORIAL=${features.TUTORIAL} DAY_NIGHT=${features.DAY_NIGHT}`
);

// One-shot world reset to vouchers. Gated on WIPE_AND_VOUCHERIZE env;
// unset = no-op. See db/index.ts for the full semantics.
maybeRunWipeAndVoucherize();

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
app.use('/api/v1/site-gate', siteGateApi);
app.use('/api/v1', agentApi);
app.use('/api', studioApi);

httpServer.listen(config.port, config.host, () => {
  console.log(
    `${GAME_NAME} server listening on http://${config.host}:${config.port} (origin=${config.clientOrigin})`
  );

  // Boot a single persistent game room so the autopilot runs even when
  // no humans are connected. Combined with GameRoom.autoDispose=false
  // this means agents are "online" 24/7 with the server process.
  matchMaker.createRoom('game', {})
    .then((room) => {
      console.log(`[matchMaker] game room created at boot: ${room.roomId}`);
    })
    .catch((err) => {
      console.error('[matchMaker] failed to create game room at boot:', err);
    });
});
