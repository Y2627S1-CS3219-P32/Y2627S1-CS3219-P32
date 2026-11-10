import { setTimeout } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { report } from '@campus/agent-contracts/logging';
import { encodeBusinessKey } from '@campus/agent-contracts/conversation';
import { streamConnection } from '@campus/agent-contracts/connections/redis';
import { messageId } from '@campus/agent-contracts/ids';
import { mandateSchema } from '@campus/agent-contracts/mandates';
import type { MessageContent, MessageId, TurnId, UserId, SafeError, TurnOutcome } from '@campus/agent-contracts/conversation';
import type { StreamEvent, StreamPayload } from '@campus/agent-contracts/events';
import type { ToolCall } from '@campus/agent-contracts/tools';
import type { Mandate } from '@campus/agent-contracts/mandates';
import { defaultLimits as limits } from './config.js';
import { createToolRegistry } from './llm/tools/registry.js';
import { createSystemMessage } from './llm/prompts.js';
import * as dispatcher from './llm/tools/dispatcher.js';
import * as model from './llm/model.js';
import * as mandates from './clients/mandate.js';
import * as repository from './repository.js';
import type { TurnMessage } from './repository.js';

interface TurnExecution {
  turn: Awaited<ReturnType<typeof repository.getTurn>>;
  owner: UserId;
  executionId: string;
  assistantMessageId: MessageId;
  messages: TurnMessage[];
  seenCallIds: Set<string>;
  owned: AbortSignal;
  signal: AbortSignal;
  deadline: number;
  calls: number;
  titleGeneration: Promise<void>;
  tokens: number;
  bytes: number;
}

export async function executeTurn(id: TurnId, owned: AbortSignal): Promise<TurnOutcome> {
  const savedTurn = await repository.getTurn(id);
  if (savedTurn.status !== 'processing') return savedTurn.status;
  if (!(await repository.isNextTurnToExecute(id))) throw new Error('Earlier turn is still processing');
  const deadline = Date.now() + limits.turn_timeout_ms;
  const signal = AbortSignal.any([owned, AbortSignal.timeout(limits.turn_timeout_ms)]);
  for (let retry = 0; ; retry++) {
    try {
      return await executeTurnAttempt(id, owned, signal, deadline, retry === 2);
    } catch (error) {
      if (owned.aborted || retry === 2) throw error;
      await setTimeout(200, undefined, { signal: owned });
    }
  }
}

async function executeTurnAttempt(
  id: TurnId,
  owned: AbortSignal,
  signal: AbortSignal,
  deadline: number,
  finalRetry: boolean,
): Promise<TurnOutcome> {
  const turn = await repository.getTurn(id);
  if (turn.status !== 'processing') return turn.status;
  const execution: TurnExecution = {
    turn,
    owner: await repository.getTurnOwner(id),
    executionId: randomUUID(),
    assistantMessageId: messageId.parse(randomUUID()),
    messages: [],
    seenCallIds: new Set(),
    owned, signal, deadline,
    calls: 0, tokens: 0, bytes: 0,
    titleGeneration: generateConversationTitle(id, signal),
  };
  const turnContextMessages = await repository.listTurnContextMessages(id);
  try {
    signal.throwIfAborted();
    await publishStreamEvent(execution, {
      type: 'message_reset', message_id: execution.assistantMessageId, reason: 'Starting execution',
    });
    const mandateContext = await mandates.listMandates(execution.owner, signal).catch(error => {
      if (signal.aborted) throw error;
      return [];
    });
    const existingMandate = mandateContext.find(
      mandate => mandate.business_key_id === encodeBusinessKey(turn.conversation_id, id),
    );
    if (existingMandate) return await completeTurn(execution, { kind: 'mandate', mandate: existingMandate });

    const systemMessage = createSystemMessage(mandateContext);
    for (
      let step = 0;
      step < limits.model_steps && execution.calls < limits.tool_calls && execution.tokens < limits.max_tokens;
      step++
    ) {
      const response = await readModelStep(execution, systemMessage, turnContextMessages);
      if (execution.tokens > limits.max_tokens)
        return await failTurnLimit(execution, 'token');
      if (response.kind === 'final')
        return await completeTurn(execution, { kind: 'text', text: response.text });
      if (execution.calls + response.calls.length > limits.tool_calls) break;

      const pendingMandate = await executeToolBatch(execution, response.calls);
      execution.assistantMessageId = messageId.parse(randomUUID());
      if (pendingMandate) {
        await publishStreamEvent(execution, {
          type: 'mandate_proposed',
          mandate_id: pendingMandate.id,
          terms_hash: pendingMandate.terms_hash,
          terms: pendingMandate.terms,
          expires_at: pendingMandate.terms.expires_at,
        });
        return await completeTurn(execution, { kind: 'mandate', mandate: pendingMandate });
      }
    }
    return await failTurnLimit(execution, 'execution');
  } catch (error) {
    if (owned.aborted) throw error;
    report(error);
    if (!finalRetry && !signal.aborted) throw error;
    return completeTurn(execution,
      { kind: 'text', text: 'Please send your message again.' },
      'failed',
      {
        code: signal.aborted ? 'TURN_TIMEOUT' : 'TURN_FAILED',
        message: 'The request could not be completed',
        retryable: false,
      },
    );
  }
}

async function readModelStep(
  execution: TurnExecution,
  systemMessage: model.ModelMessage,
  turnContextMessages: TurnMessage[],
): Promise<model.ModelResponse> {
  execution.signal.throwIfAborted();
  await publishStreamEvent(execution, { type: 'message_started', message_id: execution.assistantMessageId });
  let response: model.ModelResponse | undefined;
  let usage = 0, stepBytes = 0;
  for await (const fragment of model.streamModelResponse(
    [systemMessage, ...turnContextMessages, ...execution.messages],
    [...createToolRegistry().values()].map(tool => tool.definition),
    execution.signal,
    limits.max_tokens - execution.tokens,
  )) {
    if (fragment.kind === 'text') {
      await publishStreamEvent(execution, {
        type: 'message_delta', message_id: execution.assistantMessageId, text: fragment.text,
      });
    }
    const fragmentBytes = fragment.kind === 'text' ? Buffer.byteLength(fragment.text)
      : fragment.kind === 'tool_arguments' ? Buffer.byteLength(fragment.fragment) : 0;
    stepBytes += fragmentBytes;
    execution.bytes += fragmentBytes;
    if (execution.bytes > limits.max_output_bytes) throw new Error('Turn output limit exceeded');
    if (fragment.kind === 'usage') usage = fragment.tokens;
    if (fragment.kind === 'complete') response = fragment.response;
  }
  execution.tokens += usage || stepBytes;
  if (!response) throw new Error('Model did not complete');
  return response;
}

async function executeToolBatch(execution: TurnExecution, calls: ToolCall[]): Promise<Mandate | undefined> {
  const preparedCalls = calls.map(call => dispatcher.prepareToolCall(call));
  for (const tool of preparedCalls) {
    if (execution.seenCallIds.has(tool.call.id)) throw new Error('Repeated tool call ID');
    execution.seenCallIds.add(tool.call.id);
  }
  execution.messages.push(createTurnMessage(execution, { kind: 'tool_calls', calls }));
  let pendingMandate: Mandate | undefined;
  for (const tool of preparedCalls) {
    execution.calls++;
    const status = {
      tool_call_id: tool.call.id,
      tool_name: tool.call.name,
      display_text: tool.call.name.replaceAll('_', ' '),
    };
    await publishStreamEvent(execution, { ...status, type: 'tool_status', status: 'running' });
    const result = await dispatcher.executeToolCall(tool, {
      user_id: execution.owner,
      conversation_id: execution.turn.conversation_id,
      turn_id: execution.turn.id,
      tool_call_id: tool.call.id,
      signal: execution.signal,
      deadline: execution.deadline,
      trace_id: execution.turn.id,
    });
    execution.messages.push(createTurnMessage(execution, {
      kind: 'tool_result', tool_call_id: tool.call.id, result,
    }, 'tool'));
    await publishStreamEvent(execution, { ...status, type: 'tool_status', status: result.ok ? 'completed' : 'failed' });
    if (tool.call.name === 'propose_mandate' && result.ok) {
      const mandate = mandateSchema.parse(result.data);
      if (mandate.status === 'pending') pendingMandate = mandate;
    }
  }
  return pendingMandate;
}

function createTurnMessage(
  execution: TurnExecution,
  content: MessageContent,
  role: TurnMessage['role'] = 'assistant',
  id = messageId.parse(randomUUID()),
): TurnMessage {
  return { id, conversation_id: execution.turn.conversation_id, turn_id: execution.turn.id, role, content };
}

async function publishStreamEvent(execution: TurnExecution, payload: StreamPayload) {
  const event: StreamEvent = {
    ...payload,
    schema_version: 1,
    event_id: randomUUID(),
    conversation_id: execution.turn.conversation_id,
    turn_id: execution.turn.id,
    stream_id: execution.executionId,
    occurred_at: new Date().toISOString(),
  };
  try {
    await streamConnection().publish(event, AbortSignal.any([execution.owned, AbortSignal.timeout(3000)]));
  } catch {
    // Durable history remains authoritative.
  }
}

async function completeTurn(
  execution: TurnExecution,
  content: MessageContent | null,
  outcome: TurnOutcome = 'completed',
  error: SafeError | null = null,
): Promise<TurnOutcome> {
  await execution.titleGeneration;
  const messages = content
    ? [...execution.messages, createTurnMessage(execution, content, 'assistant', execution.assistantMessageId)]
    : execution.messages;
  await repository.saveTurnOutcome(execution.turn.id, outcome, messages, error, execution.owned);
  const sequence = await repository.getLastMessageSequence(execution.turn.id);
  if (content?.kind === 'text' && outcome === 'completed')
    await publishStreamEvent(execution, {
      type: 'message_completed', message_id: execution.assistantMessageId, status: 'completed', text: content.text,
    });
  await publishStreamEvent(execution, outcome === 'completed'
    ? { type: 'turn_completed', status: 'completed', last_message_seq: sequence }
    : {
        type: 'turn_failed', code: error?.code ?? 'TURN_FAILED',
        display_text: error?.message ?? 'This request failed', last_message_seq: sequence,
      },
  );
  return outcome;
}

function failTurnLimit(execution: TurnExecution, limit: 'token' | 'execution') {
  return completeTurn(execution,
    { kind: 'text', text: 'Please send your message again.' },
    'failed',
    { code: 'TURN_LIMIT', message: limit === 'token' ? 'Token limit exceeded' : 'Execution limit exceeded', retryable: false },
  );
}

async function generateConversationTitle(id: TurnId, signal: AbortSignal) {
  try {
    const text = await repository.getConversationTitleInput(id);
    if (text === null) return;
    const title = await model.generateConversationTitle(`Conversation first message: ${text}`, text.slice(0, 100), signal);
    await repository.saveConversationTitle(id, title);
  } catch {
    // The conversation remains usable with its default title.
  }
}
