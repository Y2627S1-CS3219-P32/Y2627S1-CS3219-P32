import express from 'express';
import { errorHandler, HttpError } from './handlers/http.js';
import { httpRouter, internalRouter } from './handlers/routes.js';

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
  app.use('/internal', internalRouter);
  app.use(httpRouter);
  app.use(() => { throw new HttpError(404, 'Route not found'); });
  app.use(errorHandler);
  return app;
}
