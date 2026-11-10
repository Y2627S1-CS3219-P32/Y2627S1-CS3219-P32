import { z } from 'zod';
import { toolCallSchema, toolResultSchema } from '@campus/agent-contracts/tools';
import { createToolRegistry } from './registry.js';
import { ConnectionError } from '../../clients/transport.js';
import type { PreparedTool } from './registry.js';
import type { ToolContext, ToolResult } from '@campus/agent-contracts/tools';
export function prepareToolCall(raw: unknown): PreparedTool {
  if (Buffer.byteLength(JSON.stringify(raw)) > 32768) throw new Error('Tool arguments too large');
  const call = toolCallSchema.parse(raw),
    tool = createToolRegistry().get(call.name);
  if (!tool || tool.definition.version !== call.version) throw new Error('Unsupported tool');
  try {
    return { call, invoke: tool.prepare(call.arguments) };
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    const message = error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    return {
      call,
      invoke: async () => ({
        ok: false,
        error: { code: 'INVALID_ARGUMENTS', message, retryable: true },
      }),
    };
  }
}
export async function executeToolCall(prepared: PreparedTool, context: ToolContext): Promise<ToolResult> {
  context.signal.throwIfAborted();
  if (Date.now() >= context.deadline) throw new Error('Turn deadline exceeded');
  try {
    const result = toolResultSchema.parse(await prepared.invoke(context));
    if (Buffer.byteLength(JSON.stringify(result)) > 65536)
      return {
        ok: false,
        error: { code: 'OUTPUT_LIMIT', message: 'Tool result is too large', retryable: false },
      };
    return result;
  } catch (error) {
    if (error instanceof ConnectionError && error.kind === 'rejected')
      return {
        ok: false,
        error: {
          code: error.status === 409 ? 'CONFLICT' : 'REJECTED',
          message:
            error.status === 409
              ? 'Operation conflicts with an earlier request or the current order state'
              : 'The service rejected this action',
          retryable: false,
        },
      };
    if (error instanceof z.ZodError)
      return {
        ok: false,
        error: {
          code: 'INVALID_RESPONSE',
          message: 'The service returned invalid data',
          retryable: false,
        },
      };
    throw error;
  }
}
