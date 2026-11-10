import { brokerConnection } from '@campus/agent-contracts/connections/pubsub';
import { locked } from '@campus/agent-contracts/db/client';
import * as repository from './repository.js';
export async function publishPendingTurns(signal: AbortSignal) {
  const topic = process.env.TURN_TOPIC;
  if (!topic) throw new Error('Missing TURN_TOPIC');
  for (const { conversation_id } of await repository.listConversationsWithPendingTurns())
    await locked(`publish:${conversation_id}`, signal, async (owned) => {
      let event;
      while ((event = await repository.getNextUnpublishedTurn(conversation_id))) {
        owned.throwIfAborted();
        await brokerConnection().publishTurn(topic, event);
        owned.throwIfAborted();
        await repository.markTurnPublished(event);
      }
    });
}
