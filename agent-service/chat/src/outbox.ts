// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-11-10.
// Scope: each turn is published in the trace it was requested in (attributes.traceparent,
// stored with the outbox row). Author review: Pending.
import { brokerConnection } from '@campus/agent-contracts/connections/pubsub';
import { locked } from '@campus/agent-contracts/db/client';
import { withTraceparent } from '@campus/agent-contracts/shared/messaging';
import * as repository from './repository.js';
export async function publishPendingTurns(signal: AbortSignal) {
  const topic = process.env.TURN_TOPIC;
  if (!topic) throw new Error('Missing TURN_TOPIC');
  for (const { conversation_id } of await repository.listConversationsWithPendingTurns())
    await locked(`publish:${conversation_id}`, signal, async (owned) => {
      let event;
      while ((event = await repository.getNextUnpublishedTurn(conversation_id))) {
        owned.throwIfAborted();
        const pending = event;
        await withTraceparent(pending.attributes.traceparent, () =>
          brokerConnection().publishTurn(topic, pending),
        );
        owned.throwIfAborted();
        await repository.markTurnPublished(event);
      }
    });
}
