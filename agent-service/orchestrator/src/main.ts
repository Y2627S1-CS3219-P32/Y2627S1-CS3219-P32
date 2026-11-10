import { createServer } from 'node:http';
import { sendJson, sendHttpError, HttpError } from '@campus/agent-contracts/http';
import { report } from '@campus/agent-contracts/logging';
import { pool, closeDatabase } from '@campus/agent-contracts/db/client';
import { streamConnection, closeStreamConnection } from '@campus/agent-contracts/connections/redis';
import { brokerConnection, closeBrokerConnection } from '@campus/agent-contracts/connections/pubsub';
import { createTransport, httpConfig } from '@campus/agent-contracts/connections/http';
import { consumeTurnRequests } from './handlers/turnRequestHandler.js';
if (!process.env.SOCLAAS_API_KEY || !process.env.SOCLAAS_MODEL)
  throw new Error('SOCLAAS_API_KEY and SOCLAAS_MODEL are required');
createTransport(httpConfig());
const shutdown = new AbortController();
const tasks = consumeTurnRequests(shutdown.signal).catch((error: unknown) => {
  report(error);
  shutdown.abort();
});
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/health/live') return sendJson(response, { status: 'ok' });
    if (request.url === '/health/ready') {
      if (shutdown.signal.aborted) throw new HttpError(503, 'Stopping');
      try {
        await pool().query('SELECT 1');
        await ready();
      } catch {
        throw new HttpError(503, 'Dependencies unavailable');
      }
      return sendJson(response, { status: 'ready' });
    }
    throw new HttpError(404, 'Route not found');
  } catch (error) {
    sendHttpError(response, error);
  }
});
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

async function ready() {
  await streamConnection().ping();
  await brokerConnection().ready([], [process.env.TURN_SUBSCRIPTION ?? '']);
}
