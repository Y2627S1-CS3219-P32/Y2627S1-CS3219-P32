import { approvalSchema } from '@campus/agent-contracts/events';
import { conversationId, turnId } from '@campus/agent-contracts/ids';
import { decodeBusinessKey } from '@campus/agent-contracts/conversation';
import { HttpError } from '@campus/agent-contracts/errors';
import { getTurnHistory, submitTurn } from '../services.js';

export async function handleMandateApproved(event: unknown, signal: AbortSignal) {
  signal.throwIfAborted();
  const approval = approvalSchema.parse(event);
  const businessKey = decodeBusinessKey(approval.business_key_id);
  const conversation = conversationId.parse(businessKey.conversation_id);
  const origin = turnId.parse(businessKey.turn_id);
  const { turn, messages } = await getTurnHistory(approval.user_id, conversation, origin);
  if (
    turn.status !== 'completed' ||
    !messages.some(message =>
      message.content.kind === 'mandate' &&
      message.content.mandate.id === approval.mandate_id &&
      message.content.mandate.user_id === approval.user_id &&
      message.content.mandate.business_key_id === approval.business_key_id,
    )
  ) throw new HttpError(409, 'Approval does not match a completed proposal');

  signal.throwIfAborted();
  await submitTurn(approval.user_id, conversation, {
    client_request_id: `approval:${approval.mandate_id}`,
    text: `The user approved mandate ${approval.mandate_id}. Continue the original request using the approved terms. Do not recreate any order already shown as successfully placed in history.`,
  });
}
