import { z } from 'zod';
import * as transport from './transport.js';
import { mandateSchema } from '@campus/agent-contracts/mandates';
import type { UserId } from '@campus/agent-contracts/conversation';
import type {
  MandateId,
  CreateMandate,
  CoverageRequest,
  Coverage,
} from '@campus/agent-contracts/mandates';
const coverageSchema = z.discriminatedUnion('covered', [
  z.object({ covered: z.literal(true), mandate: mandateSchema }),
  z.object({ covered: z.literal(false), reason: z.string() }),
]);
function requestMandateService(capability: string, body: unknown, key: string | null, signal: AbortSignal) {
  return transport.requestInternalService({
    destination: 'mandate',
    path: capability === 'create' ? '/internal/mandates' : `/internal/mandates/${capability}`,
    method: 'POST',
    body,
    operation_key: key,
    signal,
  });
}
export async function createMandate(owner: UserId, input: CreateMandate, signal: AbortSignal) {
  const mandate = mandateSchema.parse(
    await requestMandateService('create', { user_id: owner, ...input }, input.business_key_id, signal),
  );
  if (mandate.user_id !== owner || mandate.business_key_id !== input.business_key_id)
    throw new Error('Mismatched mandate response');
  return mandate;
}
export async function listMandates(owner: UserId, signal: AbortSignal) {
  const result = z
    .array(mandateSchema)
    .max(500)
    .parse(await requestMandateService('context', { user_id: owner }, null, signal));
  if (result.some((mandate) => mandate.user_id !== owner))
    throw new Error('Mismatched mandate owner');
  return result;
}
export async function getMandate(owner: UserId, id: MandateId, signal: AbortSignal) {
  const mandate = mandateSchema.parse(
    await requestMandateService('get', { user_id: owner, mandate_id: id }, null, signal),
  );
  if (mandate.user_id !== owner || mandate.id !== id)
    throw new Error('Mismatched mandate response');
  return mandate;
}
export async function checkMandateCoverage(input: CoverageRequest, signal: AbortSignal): Promise<Coverage> {
  const result = coverageSchema.parse(await requestMandateService('coverage', input, null, signal));
  if (result.covered && result.mandate.user_id !== input.user_id)
    throw new Error('Mismatched coverage owner');
  return result;
}
