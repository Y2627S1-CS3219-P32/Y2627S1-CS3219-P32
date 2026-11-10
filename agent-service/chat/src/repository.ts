import { z } from 'zod';
import { sql, rows } from '@campus/agent-contracts/db/client';
import { conversationId } from '@campus/agent-contracts/ids';
import {
  conversationSchema,
  messageSchema,
  turnSchema as savedTurnSchema,
} from '@campus/agent-contracts/conversation';
import { turnSchema } from '@campus/agent-contracts/events';
import type { UserId, ConversationId, Conversation, Message, Turn, TurnId, MessageId } from '@campus/agent-contracts/conversation';
import type { TurnRequested } from '@campus/agent-contracts/events';

export function listConversations(owner: UserId, cursor: ConversationId | null, limit: number) {
  return rows(
    conversationSchema,
    'SELECT * FROM conversations WHERE user_id=$1 AND ($2::uuid IS NULL OR id<$2) ORDER BY id DESC LIMIT $3',
    [owner, cursor, limit],
  );
}

export async function createConversation(input: Omit<Conversation, 'next_message_seq'>) {
  const [value] = await rows(
    conversationSchema,
    'INSERT INTO conversations(id,user_id,title) VALUES($1,$2,$3) RETURNING *',
    [input.id, input.user_id, input.title],
  );
  return conversationSchema.parse(value);
}

export async function getConversation(owner: UserId, id: ConversationId, lock = false) {
  const [value] = await rows(
    conversationSchema,
    `SELECT * FROM conversations WHERE id=$1 AND user_id=$2${lock ? ' FOR UPDATE' : ''}`,
    [id, owner],
  );
  return value;
}

export function listMessages(conversation: ConversationId, after: number, limit: number) {
  return rows(
    messageSchema,
    'SELECT * FROM messages WHERE conversation_id=$1 AND seq>$2 ORDER BY seq LIMIT $3',
    [conversation, after, limit],
  );
}

export function listTurns(conversation: ConversationId, after: number, through: number) {
  return rows(
    savedTurnSchema,
    `SELECT * FROM turns WHERE conversation_id=$1 AND (status='processing' OR id IN (SELECT turn_id FROM messages WHERE conversation_id=$1 AND seq>$2 AND seq<=$3)) ORDER BY created_at`,
    [conversation, after, through],
  );
}

export async function findTurnByRequestId(conversation: ConversationId, requestId: string) {
  const [value] = await rows(
    savedTurnSchema,
    'SELECT * FROM turns WHERE conversation_id=$1 AND client_request_id=$2',
    [conversation, requestId],
  );
  return value;
}

export async function getTurn(conversation: ConversationId, id: TurnId) {
  const [value] = await rows(
    savedTurnSchema,
    'SELECT * FROM turns WHERE id=$1 AND conversation_id=$2',
    [id, conversation],
  );
  return value;
}

export async function getMessage(id: MessageId) {
  const [value] = await rows(messageSchema, 'SELECT * FROM messages WHERE id=$1', [id]);
  return value;
}

export function listTurnMessages(id: TurnId) {
  return rows(messageSchema, 'SELECT * FROM messages WHERE turn_id=$1', [id]);
}

export async function createTurn(input: Pick<Turn, 'id' | 'conversation_id' | 'trigger_message_id' | 'client_request_id'>) {
  await sql(
    'INSERT INTO turns(id,conversation_id,trigger_message_id,client_request_id) VALUES($1,$2,$3,$4)',
    [input.id, input.conversation_id, input.trigger_message_id, input.client_request_id],
  );
}

export async function createMessage(input: Message) {
  await sql(
    'INSERT INTO messages(id,conversation_id,turn_id,seq,role,content) VALUES($1,$2,$3,$4,$5,$6)',
    [input.id, input.conversation_id, input.turn_id, input.seq, input.role, JSON.stringify(input.content)],
  );
}

export async function advanceMessageSequence(conversation: ConversationId) {
  await sql(
    'UPDATE conversations SET next_message_seq=next_message_seq+1,updated_at=now() WHERE id=$1',
    [conversation],
  );
}

export async function createOutboxEvent(turn: TurnId, event: TurnRequested) {
  await sql(
    'INSERT INTO turn_outbox(event_id,conversation_id,turn_id,event_type,payload) VALUES($1,$2,$3,$4,$5)',
    [event.attributes.event_id, event.data.conversation_id, turn, event.attributes.event_type, JSON.stringify(event)],
  );
}

export async function getNextUnpublishedTurn(conversation: ConversationId): Promise<TurnRequested | null> {
  const result = await sql(
    'SELECT o.payload FROM turn_outbox o JOIN turns t ON t.id=o.turn_id JOIN messages m ON m.id=t.trigger_message_id WHERE o.conversation_id=$1 AND o.published_at IS NULL ORDER BY m.seq LIMIT 1',
    [conversation],
  );
  return result.rows[0]
    ? turnSchema.parse(z.object({ payload: z.unknown() }).parse(result.rows[0]).payload)
    : null;
}

export function listConversationsWithPendingTurns() {
  return rows(
    z.object({ conversation_id: conversationId }),
    'SELECT DISTINCT conversation_id FROM turn_outbox WHERE published_at IS NULL LIMIT 50',
  );
}

export async function markTurnPublished(event: TurnRequested) {
  await sql(
    'UPDATE turn_outbox SET published_at=now() WHERE event_id=$1 AND conversation_id=$2 AND published_at IS NULL',
    [event.attributes.event_id, event.data.conversation_id],
  );
}

export async function hasProcessingTurn(id: ConversationId) {
  const result = await sql("SELECT 1 FROM turns WHERE conversation_id=$1 AND status='processing' LIMIT 1", [id]);
  return result.rows.length > 0;
}

export async function deleteConversation(id: ConversationId) {
  await sql('DELETE FROM turn_outbox WHERE conversation_id=$1', [id]);
  await sql('DELETE FROM messages WHERE conversation_id=$1', [id]);
  await sql('DELETE FROM turns WHERE conversation_id=$1', [id]);
  await sql('DELETE FROM conversations WHERE id=$1', [id]);
}
