import { Router } from 'express';
import { z } from 'zod';
import { authenticateUser } from '@campus/agent-contracts/http';
import { conversationId } from '@campus/agent-contracts/ids';
import * as service from '../services.js';
import { streamConversationEvents } from './conversationEventsHandler.js';

const createSchema = z.object({
  title: z.string().trim().min(1).max(100).default('New conversation'),
}).strict();
const messageSchema = z.object({
  client_request_id: z.string().min(1).max(200).refine(value => !value.startsWith('approval:')),
  text: z.string().trim().min(1).max(16000),
}).strict();
const historyCursor = z.coerce.number().int().nonnegative().safe();

export const httpRouter = Router();

httpRouter.get('/conversations', async function listConversations(req, res) {
  const user = authenticateUser(req);
  const cursor = conversationId.nullable().parse(req.query.cursor ?? null);
  res.json(await service.listConversations(user, cursor));
});

httpRouter.post('/conversations', async function createConversation(req, res) {
  const user = authenticateUser(req);
  const input = createSchema.parse(req.body ?? {});
  res.status(201).json(await service.createConversation(user, input.title));
});

httpRouter.delete('/conversations/:id', async function deleteConversation(req, res) {
  const user = authenticateUser(req);
  await service.deleteConversation(user, conversationId.parse(req.params.id));
  res.status(204).end();
});

httpRouter.get('/conversations/:id/messages', async function getConversationHistory(req, res) {
  const user = authenticateUser(req);
  const id = conversationId.parse(req.params.id);
  const after = historyCursor.parse(req.query.cursor ?? 0);
  res.json(await service.getConversationHistory(user, id, after));
});

httpRouter.post('/conversations/:id/messages', async function acceptConversationMessage(req, res) {
  const user = authenticateUser(req);
  const id = conversationId.parse(req.params.id);
  res.status(202).json(await service.submitTurn(user, id, messageSchema.parse(req.body)));
});

httpRouter.get('/conversations/:id/events', streamConversationEvents);
