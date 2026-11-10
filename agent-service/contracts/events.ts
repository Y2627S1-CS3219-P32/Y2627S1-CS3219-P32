import { z } from 'zod';
import type { ConversationId, TurnId, MessageId, UserId, TurnOutcome } from './conversation.js';
import type { MandateId, MandateTerms } from './mandates.js';
// IDs-only body; turn and owner are loaded from the accepted triggering message.
export interface TurnRequested {
  data: { conversation_id: ConversationId; message_id: MessageId };
  ordering_key: ConversationId;
  attributes: {
    schema_version: '1';
    event_type: 'agent.turn.requested';
    event_id: string;
    traceparent?: string | undefined;
  };
}
export interface MandateApproved {
  schema_version: 1;
  event_id: string;
  event_type: 'mandate.approved';
  mandate_id: MandateId;
  business_key_id: string;
  user_id: UserId;
  occurred_at: string;
}
export type StreamPayload =
  | { type: 'message_started'; message_id: MessageId }
  | { type: 'message_delta'; message_id: MessageId; text: string }
  | { type: 'message_reset'; message_id: MessageId; reason: string }
  | {
      type: 'tool_status';
      tool_call_id: string;
      tool_name: string;
      status: 'running' | 'completed' | 'failed';
      display_text: string;
    }
  | {
      type: 'mandate_proposed';
      mandate_id: MandateId;
      terms_hash: string;
      terms: MandateTerms;
      expires_at: string | null;
    }
  | { type: 'message_completed'; message_id: MessageId; status: 'completed'; text: string }
  | { type: 'turn_completed'; status: Exclude<TurnOutcome, 'failed'>; last_message_seq: number }
  | { type: 'turn_failed'; code: string; display_text: string; last_message_seq: number }
  | { type: 'resync_required'; reason: string };
export type StreamEvent = StreamPayload & {
  schema_version: 1;
  event_id: string;
  conversation_id: ConversationId;
  turn_id: TurnId;
  stream_id: string;
  occurred_at: string;
};

const id = z.string().min(1).max(200);
const user = z.number().int().positive().safe();
const terms = z.object({
  constraints: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('supplier_id'), value: id }),
        z.object({
          type: z.literal('max_credit_amount'),
          value: z.number().int().nonnegative().safe(),
        }),
      ]),
    )
    .max(50),
  starts_at: z.iso.datetime(),
  expires_at: z.iso.datetime().nullable(),
});
export const turnSchema = z
  .object({
    data: z
      .object({
        conversation_id: id.transform((value) => value as ConversationId),
        message_id: id.transform((value) => value as MessageId),
      })
      .strict(),
    ordering_key: id.transform((value) => value as ConversationId),
    attributes: z
      .object({
        schema_version: z.literal('1'),
        event_type: z.literal('agent.turn.requested'),
        event_id: id,
        traceparent: z.string().max(128).optional(),
      })
      .strict(),
  })
  .strict()
  .refine((event) => event.ordering_key === event.data.conversation_id);
export const approvalSchema = z
  .object({
    schema_version: z.literal(1),
    event_id: id,
    event_type: z.literal('mandate.approved'),
    mandate_id: id.transform((value) => value as MandateId),
    business_key_id: id,
    user_id: user.transform((value) => value as UserId),
    occurred_at: z.iso.datetime(),
  })
  .strict();
const payload = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message_started'), message_id: id }),
  z.object({ type: z.literal('message_delta'), message_id: id, text: z.string().max(16_384) }),
  z.object({ type: z.literal('message_reset'), message_id: id, reason: z.string().max(500) }),
  z.object({
    type: z.literal('tool_status'),
    tool_call_id: id,
    tool_name: id,
    status: z.enum(['running', 'completed', 'failed']),
    display_text: z.string().max(500),
  }),
  z.object({
    type: z.literal('mandate_proposed'),
    mandate_id: id,
    terms_hash: id,
    terms,
    expires_at: z.iso.datetime().nullable(),
  }),
  z.object({
    type: z.literal('message_completed'),
    message_id: id,
    status: z.literal('completed'),
    text: z.string().max(32_768),
  }),
  z.object({
    type: z.literal('turn_completed'),
    status: z.literal('completed'),
    last_message_seq: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('turn_failed'),
    code: id,
    display_text: z.string().max(500),
    last_message_seq: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('resync_required'), reason: z.string().max(500) }),
]);
export const streamSchema = payload.and(
  z.object({
    schema_version: z.literal(1),
    event_id: id,
    conversation_id: id,
    turn_id: id,
    stream_id: z.uuid(),
    occurred_at: z.iso.datetime(),
  }),
);
export function parseBounded<T>(schema: z.ZodType<T>, value: unknown): T {
  if (Buffer.byteLength(JSON.stringify(value)) > 65_536)
    throw new Error('Event exceeds size limit');
  return schema.parse(value);
}
