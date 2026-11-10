import express, { type ErrorRequestHandler } from 'express';
import { sendHttpError, HttpError } from '@campus/agent-contracts/http';
import { httpRouter } from './handlers/routes.js';

export function createApp(ready: () => Promise<void>) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set('cache-control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.get('/health/live', (_req, res) => { res.json({ status: 'ok' }); });
  app.get('/health/ready', async (_req, res) => {
    await ready();
    res.json({ status: 'ready' });
  });
  app.use(httpRouter);
  app.use(() => { throw new HttpError(404, 'Route not found'); });
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => sendHttpError(res, error);
  app.use(errorHandler);
  return app;
}
