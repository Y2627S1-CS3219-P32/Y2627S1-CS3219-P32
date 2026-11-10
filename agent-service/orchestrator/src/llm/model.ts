import { conversationTitleInstructions, mandateTitleInstructions } from './prompts.js';
import { z } from 'zod';
import type { Message } from '@campus/agent-contracts/conversation';
import type { ToolCall, ToolDefinition } from '@campus/agent-contracts/tools';
import { toolCallSchema } from '@campus/agent-contracts/tools';
export type ModelResponse = { kind: 'final'; text: string } | { kind: 'calls'; calls: ToolCall[] };
export type ModelFragment =
  | { kind: 'text'; text: string }
  | { kind: 'tool_arguments'; call_id: string; fragment: string }
  | { kind: 'usage'; tokens: number }
  | { kind: 'complete'; response: ModelResponse };
export type ModelMessage = Pick<Message, 'role' | 'content'>;
const chunkSchema = z.object({
  choices: z.array(
    z.object({
      delta: z
        .object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                index: z.number().int().nonnegative(),
                id: z.string().optional(),
                function: z
                  .object({ name: z.string().optional(), arguments: z.string().optional() })
                  .optional(),
              }),
            )
            .optional(),
        })
        .default({}),
      finish_reason: z.string().nullable().optional(),
    }),
  ),
  usage: z.object({ total_tokens: z.number().int().nonnegative() }).nullable().optional(),
});
export function toModelMessages(conversationMessages: ModelMessage[]) {
  return conversationMessages.map((message) => {
    const content = message.content;
    switch (content.kind) {
      case 'text':
        return { role: message.role, content: content.text };
      case 'tool_calls':
        return {
          role: 'assistant',
          content: null,
          tool_calls: content.calls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
        };
      case 'tool_result':
        return {
          role: 'tool',
          tool_call_id: content.tool_call_id,
          content: JSON.stringify(content.result),
        };
      case 'mandate':
        return {
          role: 'assistant',
          content: `An approval card was displayed for mandate ${content.mandate.id} (${content.mandate.title}). This is a historical proposal; verify current status with get_mandate. Do not reproduce the card as text.`,
        };
    }
  });
}
export async function* streamModelResponse(
  conversationMessages: ModelMessage[],
  tools: ToolDefinition[],
  signal: AbortSignal,
  maxTokens = 4096,
): AsyncIterable<ModelFragment> {
  const key = process.env.SOCLAAS_API_KEY,
    model = process.env.SOCLAAS_MODEL;
  if (!key || !model) throw new Error('SOCLAAS_API_KEY and SOCLAAS_MODEL are required');
  const base = new URL(process.env.SOCLAAS_BASE_URL ?? 'https://soclaas-api.comp.nus.edu.sg/v1/');
  if (base.protocol !== 'https:' && base.hostname !== '127.0.0.1' && base.hostname !== 'localhost')
    throw new Error('Model endpoint requires HTTPS');
  const messages = toModelMessages(conversationMessages);
  if (Buffer.byteLength(JSON.stringify(messages)) > 262144)
    throw new Error('Model context limit exceeded');
  const response = await fetch(`${base.href.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      ...(tools.length ? { tools: tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
      })) } : {}),
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: Math.max(1, Math.min(4096, maxTokens)),
    }),
    signal,
    redirect: 'error',
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Model request failed (${response.status})`);
  }
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    text = '',
    finished = false,
    doneMarker = false,
    totalBytes = 0;
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  try {
    while (!doneMarker) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      totalBytes += chunk.value.length;
      if (buffer.length > 131072 || totalBytes > 1048576)
        throw new Error('Model stream limit exceeded');
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trimEnd();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === '[DONE]') {
          doneMarker = true;
          break;
        }
        const frame = chunkSchema.parse(JSON.parse(data));
        if (frame.usage) yield { kind: 'usage', tokens: frame.usage.total_tokens };
        const choice = frame.choices[0];
        if (!choice) continue;
        if (choice.finish_reason) {
          if (!['stop', 'tool_calls'].includes(choice.finish_reason))
            throw new Error('Model output was incomplete');
          finished = true;
        }
        if (choice.delta.content) {
          text += choice.delta.content;
          if (Buffer.byteLength(text) > 32768) throw new Error('Model text limit exceeded');
          yield { kind: 'text', text: choice.delta.content };
        }
        for (const part of choice.delta.tool_calls ?? []) {
          if (calls.size >= 16 && !calls.has(part.index)) throw new Error('Too many tool calls');
          const call = calls.get(part.index) ?? { id: '', name: '', arguments: '' };
          if (part.id) call.id += part.id;
          if (part.function?.name) call.name += part.function.name;
          if (part.function?.arguments) {
            call.arguments += part.function.arguments;
            if (Buffer.byteLength(call.arguments) > 32768)
              throw new Error('Tool arguments too large');
            yield { kind: 'tool_arguments', call_id: call.id, fragment: part.function.arguments };
          }
          calls.set(part.index, call);
        }
      }
    }
    if (!finished || !doneMarker) throw new Error('Model stream interrupted');
    if (calls.size) {
      const complete = [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) =>
          toolCallSchema.parse({
            id: call.id,
            name: call.name,
            version: '1',
            arguments: JSON.parse(call.arguments),
          }),
        );
      if (new Set(complete.map((call) => call.id)).size !== complete.length)
        throw new Error('Duplicate tool call IDs');
      yield { kind: 'complete', response: { kind: 'calls', calls: complete } };
    } else yield { kind: 'complete', response: { kind: 'final', text } };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function generateConversationTitle(subject: string, fallback: string, signal: AbortSignal): Promise<string> {
  return generateTitle(conversationTitleInstructions, subject, fallback, signal);
}

export function generateMandateTitle(subject: string, fallback: string, signal: AbortSignal): Promise<string> {
  return generateTitle(mandateTitleInstructions, subject, fallback, signal);
}

async function generateTitle(instructions: string, subject: string, fallback: string, signal: AbortSignal): Promise<string> {
  try {
    const timeout = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
    for await (const fragment of streamModelResponse([
      { role: 'system', content: { kind: 'text', text: instructions } },
      { role: 'user', content: { kind: 'text', text: subject } },
    ], [], timeout, 64)) {
      if (fragment.kind === 'complete' && fragment.response.kind === 'final') {
        const title = fragment.response.text.trim().replace(/^["“]|["”]$/g, '').trim();
        if (title && title.length <= 100 && !title.includes('\n')) return title;
      }
    }
  } catch {
    // Naming must not prevent the requested action.
  }
  return fallback;
}
