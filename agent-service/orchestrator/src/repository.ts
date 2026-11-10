import { z } from 'zod';
import { sql, rows, transaction } from '@campus/agent-contracts/db/client';
import { turnSchema, messageSchema } from '@campus/agent-contracts/conversation';
import { userId, turnId } from '@campus/agent-contracts/ids';
import type { TurnId, Message, TurnOutcome, SafeError } from '@campus/agent-contracts/conversation';
export type TurnMessage = Omit<Message, 'seq'>;
export async function getTurn(id: TurnId) {
  const [turn] = await rows(turnSchema, 'SELECT * FROM turns WHERE id=$1', [id]);
  if (!turn) throw new Error('Accepted turn not found');
  return turn;
}
export async function getTurnOwner(id: TurnId) {
  const [value] = await rows(
    z.object({ user_id: userId }),
    'SELECT c.user_id FROM conversations c JOIN turns t ON t.conversation_id=c.id WHERE t.id=$1',
    [id],
  );
  if (!value) throw new Error('Turn owner not found');
  return value.user_id;
}
export async function getTurnIdByTriggerMessage(conversation: string, trigger: string) {
  const [value] = await rows(
    z.object({ id: turnId }),
    'SELECT id FROM turns WHERE conversation_id=$1 AND trigger_message_id=$2',
    [conversation, trigger],
  );
  if (!value) throw new Error('Trigger does not match accepted turn');
  return value.id;
}
export async function isNextTurnToExecute(id: TurnId) {
  const result = await sql(
    `SELECT 1 FROM turns prior JOIN messages p ON p.id=prior.trigger_message_id JOIN turns current ON current.id=$1 JOIN messages c ON c.id=current.trigger_message_id WHERE prior.conversation_id=current.conversation_id AND prior.status='processing' AND p.seq<c.seq LIMIT 1`,
    [id],
  );
  return result.rows.length === 0;
}
export async function listTurnContextMessages(id: TurnId) {
  return rows(
    messageSchema,
    `SELECT m.* FROM turns current JOIN messages trigger ON trigger.id=current.trigger_message_id JOIN messages m ON m.conversation_id=current.conversation_id JOIN turns t ON t.id=m.turn_id JOIN messages origin ON origin.id=t.trigger_message_id WHERE current.id=$1 AND (m.id=current.trigger_message_id OR (origin.seq<trigger.seq AND (t.status='completed' OR (t.status='failed' AND m.role='user')))) ORDER BY origin.seq,m.seq`,
    [id],
  );
}
export async function saveTurnOutcome(
  id: TurnId,
  outcome: TurnOutcome,
  messages: TurnMessage[],
  error: SafeError | null,
  signal: AbortSignal,
) {
  return transaction(async () => {
    signal.throwIfAborted();
    const [turn] = await rows(turnSchema, 'SELECT * FROM turns WHERE id=$1 FOR UPDATE', [id]);
    if (!turn) throw new Error('Turn missing');
    if (turn.status !== 'processing') return;
    const [conversation] = await rows(
      z.object({ next_message_seq: z.coerce.number().int().positive() }),
      'SELECT next_message_seq FROM conversations WHERE id=$1 FOR UPDATE',
      [turn.conversation_id],
    );
    if (!conversation) throw new Error('Conversation missing');
    let seq = conversation.next_message_seq;
    for (const message of messages) {
      if (message.conversation_id !== turn.conversation_id || message.turn_id !== id)
        throw new Error('Message turn mismatch');
      await sql(
        'INSERT INTO messages(id,conversation_id,turn_id,seq,role,content,tool_call_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          message.id,
          turn.conversation_id,
          id,
          seq++,
          message.role,
          JSON.stringify(message.content),
          message.content.kind === 'tool_result' ? message.content.tool_call_id : null,
        ],
      );
    }
    signal.throwIfAborted();
    await sql('UPDATE conversations SET next_message_seq=$2,updated_at=now() WHERE id=$1', [
      turn.conversation_id,
      seq,
    ]);
    await sql('UPDATE turns SET status=$2,error=$3,finished_at=now() WHERE id=$1', [
      id,
      outcome,
      error ? JSON.stringify(error) : null,
    ]);
  });
}
export async function getLastMessageSequence(id: TurnId) {
  const [value] = await rows(
    z.object({ seq: z.coerce.number().int().nonnegative() }),
    'SELECT c.next_message_seq-1 AS seq FROM conversations c JOIN turns t ON t.conversation_id=c.id WHERE t.id=$1',
    [id],
  );
  return value?.seq ?? 0;
}

export async function getConversationTitleInput(id: TurnId) {
  const [message] = await rows(messageSchema,
    "SELECT m.* FROM messages m JOIN turns t ON t.trigger_message_id=m.id JOIN conversations c ON c.id=t.conversation_id WHERE t.id=$1 AND m.seq=1 AND c.title='New conversation'", [id]);
  return message?.content.kind === 'text' ? message.content.text : null;
}
export async function saveConversationTitle(id: TurnId, title: string) {
  await sql("UPDATE conversations SET title=$2,updated_at=now() WHERE id=(SELECT conversation_id FROM turns WHERE id=$1) AND title='New conversation'", [id, title]);
}
