import { z } from 'zod';
import type { ConversationId, TurnId, MessageId, UserId } from './conversation.js';
import type { MandateId } from './mandates.js';
export const conversationId = z.uuid().transform((value) => value as ConversationId);
export const turnId = z.uuid().transform((value) => value as TurnId);
export const messageId = z.uuid().transform((value) => value as MessageId);
export const userId = z
  .number()
  .int()
  .positive()
  .safe()
  .transform((value) => value as UserId);
export const mandateId = z.uuid().transform((value) => value as MandateId);
