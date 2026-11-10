import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { HttpError } from '@campus/agent-contracts/errors';
import { report } from '@campus/agent-contracts/logging';
import { pool, closeDatabase } from '@campus/agent-contracts/db/client';
import { streamConnection, closeStreamConnection } from '@campus/agent-contracts/connections/redis';
import { brokerConnection, consume, closeBrokerConnection } from '@campus/agent-contracts/connections/pubsub';
import { createApp } from './app.js';
import { handleMandateApproved } from './handlers/mandateApprovalHandler.js';
import { publishPendingTurns } from './outbox.js';
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
    await ready();
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
  await Promise.all([closeDatabase(), closeBrokerConnection(), closeStreamConnection()]);
}
process.once('SIGTERM', () => { void stop(); });
process.once('SIGINT', () => { void stop(); });
async function start(signal: AbortSignal) {
  const subscription = process.env.APPROVAL_SUBSCRIPTION;
  if (!subscription) throw new Error('Missing APPROVAL_SUBSCRIPTION');
  await Promise.all([
    repeat(signal, () => publishPendingTurns(signal)),
    consume({
      signal,
      concurrency: 4,
      onError: report,
      pull: (signal) => brokerConnection().pullApproval(subscription, signal),
      handle: handleMandateApproved,
    }),
  ]);
}
async function ready() {
  await streamConnection().ping();
  await brokerConnection().ready(
    [process.env.TURN_TOPIC ?? ''],
    [process.env.APPROVAL_SUBSCRIPTION ?? ''],
  );
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
