import { createApp } from './app.js';
import { config } from './config.js';
import { validateInitialCredits } from './services/accounts.js';
import { pool } from './db/index.js';
// Claude Code (Opus 5.5), 2026-11-04: logs through the shared pino logger. Author review: Pending.
import { logger } from './shared/logger.js';
if (!config.jwtSecret) throw new Error('JWT_SECRET is required');
validateInitialCredits(config.initialCredits);
const server = createApp().listen(config.port, () =>
  logger.info({ port: config.port }, 'Credit API listening'),
);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => server.close(() => void pool.end()));
