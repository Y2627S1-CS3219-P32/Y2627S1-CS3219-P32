import { Router, type Request, type Response } from 'express';
import { checkDatabase } from '../repositories/health.js';
import { getBalance as readBalance } from '../services/accounts.js';
import { userId } from './auth.js';

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
