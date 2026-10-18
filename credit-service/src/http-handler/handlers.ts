import { Router, type Request, type Response } from 'express';
import { checkDatabase } from '../repositories/health.js';
import {
  getBalance as readBalance,
  getCreditOperation,
  getReservation as readReservation,
} from '../services/reads.js';
import { requireInternalCaller, userId } from './auth.js';
import { parseUuid } from '../common/validation.js';

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

export async function getOperation(req: Request, res: Response) {
  await requireInternalCaller(req);
  res.json(
    await getCreditOperation(parseUuid(req.params.requestId, 'INVALID_INPUT')),
  );
}

export async function getReservation(req: Request, res: Response) {
  await requireInternalCaller(req);
  res.json(
    await readReservation(parseUuid(req.params.orderId, 'INVALID_INPUT')),
  );
}

export const httpRouter = Router();
httpRouter.get('/health/live', getLiveness);
httpRouter.get('/health/ready', getReadiness);
httpRouter.get('/api/v1/credits/me', getBalance);
httpRouter.get('/internal/v1/credit-orders/:requestId', getOperation);
httpRouter.get('/internal/v1/credit-reservations/:orderId', getReservation);
