import { DEFAULT_SERVER_PORT } from '@gamestu/shared';

export const config = {
  port: Number(process.env.PORT) || DEFAULT_SERVER_PORT,
  host: process.env.HOST || '0.0.0.0',
  clientOrigin: process.env.CLIENT_ORIGIN || '*',
  databasePath: process.env.DATABASE_PATH || null,
  features: {
    JOBS: envBool('FEATURE_JOBS', false),
    NPCS: envBool('FEATURE_NPCS', false),
    TUTORIAL: envBool('FEATURE_TUTORIAL', false),
    DAY_NIGHT: envBool('FEATURE_DAY_NIGHT', true),
  },
};

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}
