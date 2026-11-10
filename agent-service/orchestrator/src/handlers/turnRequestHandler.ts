import type { TurnRequested } from '@campus/agent-contracts/events';
import { brokerConnection, consume } from '@campus/agent-contracts/connections/pubsub';
import { conversationId, messageId } from '@campus/agent-contracts/ids';
import { report } from '@campus/agent-contracts/logging';
import { locked } from '@campus/agent-contracts/db/client';
import { executeTurn } from '../services.js';
import { getTurnIdByTriggerMessage } from '../repository.js';
import { defaultLimits } from '../config.js';
export async function consumeTurnRequests(signal: AbortSignal) {
  const subscription = process.env.TURN_SUBSCRIPTION;
  if (!subscription) throw new Error('Missing TURN_SUBSCRIPTION');
  await consume({
    signal,
    concurrency: defaultLimits.concurrency,
    onError: report,
    pull: (signal) => brokerConnection().pullTurn(subscription, signal),
    handle: handleTurnRequested,
  });
}

export async function handleTurnRequested(event: TurnRequested, owned: AbortSignal) {
  const conversation = conversationId.parse(event.data.conversation_id),
    trigger = messageId.parse(event.data.message_id);
  const turn = await getTurnIdByTriggerMessage(conversation, trigger);
  await locked(`execute:${conversation}`, owned, (signal) => executeTurn(turn, signal));
}
