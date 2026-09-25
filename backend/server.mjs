// radio-api — feedback store and Opus composer/reviewer for radio.phareim.no.
// node:http + node:sqlite, no npm deps. Bearer RADIO_API_KEY on everything
// but GET /health. See backend/README.md.
// Run: pm2 start backend/server.mjs --name radio-api --node-args="--no-warnings"

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.mjs';
import { openDb } from './lib/db.mjs';
import { createApp } from './lib/app.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
loadEnv(join(HERE, '.env'));

const apiKey = process.env.RADIO_API_KEY;
if (!apiKey) {
  console.error('[radio-api] RADIO_API_KEY is not set (backend/.env)');
  process.exit(1);
}
const db = openDb(process.env.RADIO_DB ?? join(HERE, 'data', 'radio.db'));
const corsOrigins = (process.env.RADIO_CORS_ORIGINS ?? 'https://radio.phareim.no')
  .split(',').map((s) => s.trim()).filter(Boolean);
const { server } = createApp({ db, apiKey, corsOrigins });
const port = Number(process.env.RADIO_PORT ?? 3033);
server.listen(port, '127.0.0.1', () => console.log(`[radio-api] listening on 127.0.0.1:${port}`));

const stop = () => {
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
