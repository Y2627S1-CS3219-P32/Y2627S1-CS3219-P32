import { randomUUID } from 'node:crypto';
import { transaction } from '@campus/agent-contracts/db/client';
import { HttpError } from '@campus/agent-contracts/errors';
import { conversationId, messageId, turnId } from '@campus/agent-contracts/ids';
import { turnSchema } from '@campus/agent-contracts/events';
import type { UserId, Conversation, ConversationId, AcceptMessage, AcceptedTurn, Page, History, TurnId } from '@campus/agent-contracts/conversation';
import * as repository from './repository.js';

const pageSize = 50;

export async function listConversations(owner: UserId, cursor: ConversationId | null): Promise<Page<Conversation>> {
  const items = await repository.listConversations(owner, cursor, pageSize + 1);
  const more = items.length > pageSize;
  items.splice(pageSize);
  return { items, next_cursor: more ? (items.at(-1)?.id ?? null) : null };
}

export function createConversation(owner: UserId, title: string): Promise<Conversation> {
  return repository.createConversation({ id: conversationId.parse(randomUUID()), user_id: owner, title });
}

export async function getConversation(owner: UserId, id: ConversationId, lock = false): Promise<Conversation> {
  const conversation = await repository.getConversation(owner, id, lock);
  if (!conversation) throw new HttpError(404, 'Conversation not found');
  return conversation;
}

export function getConversationHistory(owner: UserId, id: ConversationId, after: number): Promise<History> {
  return transaction(async () => {
    const conversation = await getConversation(owner, id);
    const items = await repository.listMessages(id, after, pageSize + 1);
    const more = items.length > pageSize;
    items.splice(pageSize);
    const turns = await repository.listTurns(id, after, items.at(-1)?.seq ?? after);
    return {
      items,
      turns,
      next_cursor: more ? String(items.at(-1)?.seq) : null,
      last_message_seq: conversation.next_message_seq - 1,
    };
  }, 'repeatable read');
}

export function submitTurn(owner: UserId, conversationId: ConversationId, input: AcceptMessage): Promise<AcceptedTurn> {
  return transaction(async () => {
    const conversation = await getConversation(owner, conversationId, true);
    const existing = await repository.findTurnByRequestId(conversation.id, input.client_request_id);
    if (existing) {
      const trigger = await repository.getMessage(existing.trigger_message_id);
      if (trigger?.content.kind !== 'text' || trigger.content.text !== input.text)
        throw new HttpError(409, 'Request ID already used for different text');
      return {
        conversation_id: conversation.id,
        message_id: existing.trigger_message_id,
        turn_id: existing.id,
      };
    }

    const turn = turnId.parse(randomUUID());
    const trigger = messageId.parse(randomUUID());
    const event = turnSchema.parse({
      data: { conversation_id: conversation.id, message_id: trigger },
      ordering_key: conversation.id,
      attributes: { schema_version: '1', event_type: 'agent.turn.requested', event_id: randomUUID() },
    });
    await repository.createTurn({
      id: turn,
      conversation_id: conversation.id,
      trigger_message_id: trigger,
      client_request_id: input.client_request_id,
    });
    await repository.createMessage({
      id: trigger,
      conversation_id: conversation.id,
      turn_id: turn,
      seq: conversation.next_message_seq,
      role: 'user',
      content: { kind: 'text', text: input.text },
    });
    await repository.advanceMessageSequence(conversation.id);
    await repository.createOutboxEvent(turn, event);
    return { conversation_id: conversation.id, message_id: trigger, turn_id: turn };
  });
}

export async function getTurnHistory(owner: UserId, conversationId: ConversationId, turnId: TurnId) {
  await getConversation(owner, conversationId);
  const turn = await repository.getTurn(conversationId, turnId);
  if (!turn) throw new HttpError(404, 'Turn not found');
  const messages = await repository.listTurnMessages(turnId);
  return { turn, messages };
}

export async function deleteConversation(owner: UserId, id: ConversationId): Promise<void> {
  await transaction(async () => {
    await getConversation(owner, id, true);
    if (await repository.hasProcessingTurn(id))
      throw new HttpError(409, 'Wait for Friend to finish responding before deleting this chat');
    await repository.deleteConversation(id);
  });
}
