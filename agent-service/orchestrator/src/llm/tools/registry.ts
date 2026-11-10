import { z } from 'zod';
import { termsSchema, orderInputSchema } from '@campus/agent-contracts/mandates';
import { mandateId } from '@campus/agent-contracts/ids';
import type {
  ToolName,
  ToolDefinition,
  ToolContext,
  ToolResult,
  ToolCall,
} from '@campus/agent-contracts/tools';
import * as handlers from './handlers.js';
export interface PreparedTool {
  call: ToolCall;
  invoke(context: ToolContext): Promise<ToolResult>;
}
export interface RegisteredTool {
  definition: ToolDefinition;
  prepare(arguments_: unknown): (context: ToolContext) => Promise<ToolResult>;
}
export type ToolRegistry = ReadonlyMap<ToolName, RegisteredTool>;
function entry<T>(
  name: ToolName,
  description: string,
  schema: z.ZodType<T>,
  handler: (input: T, context: ToolContext) => Promise<ToolResult>,
  effect: 'read' | 'write' = 'read',
): RegisteredTool {
  return {
    definition: {
      name,
      version: '1',
      description,
      effect,
      input_schema: z.json().parse(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })),
      output_schema: { type: 'object' },
    },
    prepare(value) {
      const input = schema.parse(value);
      return (context) => handler(input, context);
    },
  };
}
const entries: RegisteredTool[] = [
  entry(
    'get_credit_balance',
    'Read this user’s current total, reserved, and available credits. Available credits can fund new orders; the balance can change before reservation.',
    z.object({}).strict(),
    handlers.get_credit_balance,
  ),
  entry(
    'search_suppliers',
    'Search active campus suppliers by query or resolve known supplier_ids. Use returned IDs in tool arguments and returned names in user-facing replies.',
    z
      .object({ query: z.string().max(200).default(''), supplier_ids: z.array(z.uuid()).max(50).default([]) })
      .strict(),
    handlers.search_suppliers,
  ),
  entry(
    'get_order',
    'Read an order belonging to this user.',
    z.object({ order_id: z.uuid() }).strict(),
    handlers.get_order,
  ),
  entry(
    'get_mandate',
    'Read authoritative mandate terms and status.',
    z.object({ mandate_id: mandateId }).strict(),
    handlers.get_mandate,
  ),
  entry(
    'propose_mandate',
    'Create a pending authorization for user review. Missing constraint types are unrestricted. Never approve mandates.',
    z.object({
      constraints: termsSchema.in.shape.constraints,
      starts_at: z.iso.datetime().optional(),
      expires_at: z.iso.datetime().nullable().optional(),
    }).strict().transform(value => termsSchema.parse({ ...value, starts_at: value.starts_at ?? new Date().toISOString() })),
    handlers.propose_mandate,
    'write',
  ),
  entry(
    'place_order',
    'Create at most one order per user turn. Requires active mandate coverage. Ask for missing order details first.',
    orderInputSchema,
    handlers.place_order,
    'write',
  ),
  entry(
    'cancel_order',
    'Cancel the user’s own order if its state permits. No mandate is required.',
    z.object({ order_id: z.uuid() }).strict(),
    handlers.cancel_order,
    'write',
  ),
];
const registry: ToolRegistry = new Map(entries.map((tool) => [tool.definition.name, tool]));
export function createToolRegistry(): ToolRegistry {
  return registry;
}
