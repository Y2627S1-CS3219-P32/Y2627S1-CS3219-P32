import { z } from 'zod';
import type { UserId } from '@campus/agent-contracts/conversation';
import * as transport from './transport.js';

const credits = z.number().int().nonnegative().safe();
const balanceSchema = z.object({
  totalCredits: credits,
  reservedCredits: credits,
  availableCredits: credits,
}).refine(balance => balance.availableCredits === balance.totalCredits - balance.reservedCredits);

export async function getBalance(owner: UserId, signal: AbortSignal) {
  return balanceSchema.parse(await transport.requestInternalService({
    destination: 'credit',
    path: '/internal/credits/balance',
    method: 'POST',
    body: { user_id: owner },
    operation_key: null,
    signal,
  }));
}
