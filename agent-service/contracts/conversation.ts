import { z } from 'zod';
import { conversationId, turnId, messageId, userId } from './ids.js';
import { toolCallSchema, toolResultSchema, safeErrorSchema } from './tools.js';
import { mandateSchema } from './mandates.js';
import type { ToolCall, ToolResult } from './tools.js';
import type { Mandate } from './mandates.js';
export type Id<Kind extends string> = string & { readonly __kind: Kind };
export type ConversationId = Id<'conversation'>;
export type TurnId = Id<'turn'>;
export type MessageId = Id<'message'>;
export type UserId = number & { readonly __kind: 'user' };
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type TurnOutcome = 'completed' | 'failed';
export type TurnStatus = 'processing' | TurnOutcome;
export interface SafeError { code: string; message: string; retryable: boolean }
export interface Conversation { id: ConversationId; user_id: UserId; title: string; next_message_seq: number }
export type MessageContent =
  | { kind: 'text'; text: string }
  | { kind: 'tool_calls'; calls: ToolCall[] }
  | { kind: 'tool_result'; tool_call_id: string; result: ToolResult }
  | { kind: 'mandate'; mandate: Mandate };
export interface Message {
  id: MessageId; conversation_id: ConversationId; turn_id: TurnId | null;
  seq: number; role: 'system' | 'user' | 'assistant' | 'tool'; content: MessageContent;
}
export type TurnCompletion =
  | { status: 'processing'; finished_at: null }
  | { status: 'completed'; finished_at: string }
  | { status: 'failed'; finished_at: string; error: SafeError };
export type Turn = TurnCompletion & {
  id: TurnId; conversation_id: ConversationId; trigger_message_id: MessageId;
  client_request_id: string;
};
export interface AcceptMessage { client_request_id: string; text: string }
export interface AcceptedTurn { conversation_id: ConversationId; message_id: MessageId; turn_id: TurnId }
export interface Page<T> { items: T[]; next_cursor: string | null }
export interface History extends Page<Message> { turns: Turn[]; last_message_seq: number }

export const contentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({ kind: z.literal('tool_calls'), calls: z.array(toolCallSchema) }),
  z.object({ kind: z.literal('tool_result'), tool_call_id: z.string(), result: toolResultSchema }),
  z.object({ kind: z.literal('mandate'), mandate: mandateSchema }),
]);
export const conversationSchema = z.object({
  id: conversationId,
  user_id: userId,
  title: z.string(),
  next_message_seq: z.coerce.number().int().positive(),
});
export const messageSchema = z.object({
  id: messageId,
  conversation_id: conversationId,
  turn_id: turnId.nullable(),
  seq: z.coerce.number().int().positive(),
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: contentSchema,
});
export const turnSchema = z
  .object({
    id: turnId,
    conversation_id: conversationId,
    trigger_message_id: messageId,
    client_request_id: z.string(),
    status: z.enum(['processing', 'completed', 'failed']),
    finished_at: z.coerce.date().nullable(),
    error: safeErrorSchema.nullable(),
    created_at: z.coerce.date(),
  })
  .transform((value) => {
    const base = {
      id: value.id,
      conversation_id: value.conversation_id,
      trigger_message_id: value.trigger_message_id,
      client_request_id: value.client_request_id,
      created_at: value.created_at,
    };
    if (value.status === 'processing') return { ...base, status: value.status, finished_at: null };
    if (!value.finished_at) throw new Error('Terminal turn is missing completion date');
    if (value.status === 'failed')
      return {
        ...base,
        status: value.status,
        finished_at: value.finished_at.toISOString(),
        error: safeErrorSchema.parse(value.error),
      };
    return { ...base, status: value.status, finished_at: value.finished_at.toISOString() };
  });

export function encodeBusinessKey(conversation: ConversationId, turn: TurnId): string {
  return JSON.stringify({ conversation_id: conversation, turn_id: turn });
}

export function decodeBusinessKey(key: string): { conversation_id: string; turn_id: string } {
  const value: unknown = JSON.parse(key);
  if (typeof value !== 'object' || value === null ||
      !('conversation_id' in value) || typeof value.conversation_id !== 'string' || !value.conversation_id ||
      !('turn_id' in value) || typeof value.turn_id !== 'string' || !value.turn_id) {
    throw new Error('Invalid agent business key');
  }
  return { conversation_id: value.conversation_id, turn_id: value.turn_id };
}
