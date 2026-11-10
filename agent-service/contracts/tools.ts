import { z } from 'zod';
import type { ConversationId, TurnId, UserId, Json, SafeError } from './conversation.js';
export type ToolName = 'search_suppliers' | 'get_order' | 'get_credit_balance' | 'propose_mandate' | 'get_mandate' | 'place_order' | 'cancel_order';
export type ToolResult =
  | { ok: true; data: Json; resource_id?: string }
  | { ok: false; error: SafeError };
export interface ToolCall { id: string; name: ToolName; version: string; arguments: Json }
export type ToolDefinition = {
  name: ToolName; version: string; description: string;
  input_schema: Json; output_schema: Json;
  effect: 'read' | 'write';
};
// All context comes from accepted work and verified identity, never model arguments.
export interface ToolContext {
  user_id: UserId; conversation_id: ConversationId; turn_id: TurnId; tool_call_id: string;
  signal: AbortSignal; deadline: number; trace_id: string;
}
export type ToolHandler<Input> = (input: Input, context: ToolContext) => Promise<ToolResult>;
export interface Tool<Input> {
  definition: ToolDefinition;
  parse(arguments_: unknown): Input;
  handler: ToolHandler<Input>;
}

export const safeErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
export const toolResultSchema = z.discriminatedUnion('ok', [
  z
    .object({ ok: z.literal(true), data: z.json(), resource_id: z.string().optional() })
    .transform((value) =>
      value.resource_id === undefined
        ? { ok: value.ok, data: value.data }
        : { ok: value.ok, data: value.data, resource_id: value.resource_id },
    ),
  z.object({ ok: z.literal(false), error: safeErrorSchema }),
]);
export const toolCallSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.enum([
    'get_credit_balance',
    'search_suppliers',
    'get_order',
    'propose_mandate',
    'get_mandate',
    'place_order',
    'cancel_order',
  ]),
  version: z.literal('1'),
  arguments: z.json(),
});
