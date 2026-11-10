import { Router, type Request, type Response } from 'express';
import { checkDatabase } from '../repositories/health.js';
import { getBalance as readBalance } from '../services/accounts.js';
import { requireInternalCaller, userId } from './auth.js';
import { parsePositiveInt32 } from '../common/validation.js';

export function getLiveness(_req: Request, res: Response) {
  res.json({ status: 'ok' });
}

export async function getReadiness(_req: Request, res: Response) {
  await checkDatabase();
  res.json({ status: 'ok' });
}

export async function getBalance(req: Request, res: Response) {
  res.json(await readBalance(userId(req)));
}

export const httpRouter = Router();
httpRouter.get('/health/live', getLiveness);
httpRouter.get('/health/ready', getReadiness);
httpRouter.get('/api/v1/credits/me', getBalance);
httpRouter.post('/internal/credits/balance', async (req, res) => {
  await requireInternalCaller(req);
  const body: unknown = req.body;
  const owner = parsePositiveInt32(
    typeof body === 'object' && body !== null && 'user_id' in body ? body.user_id : undefined,
    'INVALID_INPUT',
  );
  res.json(await readBalance(owner));
});
