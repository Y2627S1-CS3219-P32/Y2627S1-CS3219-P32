import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { HttpError } from './common/validation.js';
import { report } from './common/logging.js';
import { pool, closeDatabase } from './db/client.js';
import { publishPendingApprovals, checkApprovalPublisherReadiness, closeBrokerConnection } from './outbox.js';
import { createApp } from './app.js';
import { expireMandates } from './repository.js';
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
  throw new Error('JWT_SECRET must have at least 32 characters');
const shutdown = new AbortController();
const tasks = start(shutdown.signal).catch((error: unknown) => {
  report(error);
  shutdown.abort();
});
const server = createServer(createApp(async () => {
  if (shutdown.signal.aborted) throw new HttpError(503, 'Stopping');
  try {
    await pool().query('SELECT 1');
    await checkApprovalPublisherReadiness();
  } catch {
    throw new HttpError(503, 'Dependencies unavailable');
  }
}));
server.requestTimeout = 15000;
server.listen(Number(process.env.PORT ?? 3000));
async function stop() {
  shutdown.abort();
  server.close();
  server.closeIdleConnections();
  await tasks;
  server.closeAllConnections();
  await Promise.all([closeDatabase(), closeBrokerConnection()]);
}
process.once('SIGTERM', () => { void stop(); });
process.once('SIGINT', () => { void stop(); });
async function start(signal: AbortSignal) {
  await repeat(signal, async () => {
    await expireMandates();
    await publishPendingApprovals(signal);
  });
}

async function repeat(signal: AbortSignal, work: () => Promise<void>) {
  while (!signal.aborted) {
    try {
      await work();
    } catch (error) {
      if (!signal.aborted) report(error);
    }
    await delay(500, undefined, { signal }).catch((error: unknown) => {
      if (!signal.aborted) throw error;
    });
  }
}
