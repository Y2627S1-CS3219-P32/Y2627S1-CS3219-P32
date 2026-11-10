import { Router } from 'express';
import { z } from 'zod';
import { authenticateUser, authenticateInternalCaller } from './http.js';
import { userId, mandateId, termsSchema, actionSchema } from '../common/validation.js';
import * as service from '../services.js';

const createSchema = z.object({
  user_id: userId,
  business_key_id: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(100).default('Order authorization'),
  terms: termsSchema,
}).strict();
const ownerSchema = z.object({ user_id: userId }).strict();
const getSchema = ownerSchema.extend({ mandate_id: mandateId });
const coverageSchema = ownerSchema.extend({ action: actionSchema });
const approvalSchema = z.object({ terms_hash: z.string().min(1), consent: z.literal(true) }).strict();
const emptySchema = z.object({}).strict();

export const internalRouter = Router();
internalRouter.use(async function requireInternalCaller(req, _res, next) {
  await authenticateInternalCaller(req);
  next();
});

internalRouter.post(['/mandates', '/mandates/create'], async function createMandate(req, res) {
  const input = createSchema.parse(req.body);
  res.status(201).json(await service.createMandate({ owner: input.user_id, request: input }));
});

internalRouter.post('/mandates/context', async function getMandateContext(req, res) {
  const input = ownerSchema.parse(req.body);
  res.json(await service.listMandateContext(input.user_id));
});

internalRouter.post('/mandates/get', async function getInternalMandate(req, res) {
  const input = getSchema.parse(req.body);
  res.json(await service.getMandate(input.user_id, input.mandate_id));
});

internalRouter.post('/mandates/coverage', async function checkMandateCoverage(req, res) {
  res.json(await service.checkMandateCoverage(coverageSchema.parse(req.body)));
});

export const httpRouter = Router();

httpRouter.get('/mandates', async function listMandates(req, res) {
  const user = authenticateUser(req);
  const cursor = z.string().nullable().parse(req.query.cursor ?? null);
  res.json(await service.listMandates(user, cursor, true));
});

httpRouter.get('/mandates/:id', async function getMandate(req, res) {
  const user = authenticateUser(req);
  res.json(await service.getMandate(user, mandateId.parse(req.params.id)));
});

httpRouter.post('/mandates/:id/approve', async function approveMandate(req, res) {
  const user = authenticateUser(req);
  const id = mandateId.parse(req.params.id);
  const input = approvalSchema.parse(req.body);
  res.json(await service.approveMandate({ owner: user, request: { ...input, mandate_id: id } }));
});

for (const action of ['pause', 'resume', 'revoke'] as const) {
  httpRouter.post(`/mandates/:id/${action}`, async function transitionMandate(req, res) {
    const user = authenticateUser(req);
    const id = mandateId.parse(req.params.id);
    emptySchema.parse(req.body ?? {});
    res.json(await service.transitionMandate({ owner: user, mandate: id, action }));
  });
}
