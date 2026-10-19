import { randomUUID } from 'node:crypto';
import { OPERATION_KIND, type Kind, type Outcome, type OutcomeEvent } from '../common/types.js';

export function formatOutcome(
  data: Omit<Outcome, 'status' | 'httpStatus'>,
): Outcome {
  return {
    ...data,
    status: data.code === 'OK' ? 'SUCCEEDED' : 'REJECTED',
    httpStatus: data.code === 'OK' ? 200 : 409,
  };
}

export function outcomeEvent(
  kind: Kind | 'ALLOCATE',
  correlationId: string,
  result: Outcome,
): OutcomeEvent {
  const types = {
    ALLOCATE: 'credit.account_allocated',
    [OPERATION_KIND.RESERVE]: 'credit.reserved',
    [OPERATION_KIND.RELEASE]: 'credit.released',
    [OPERATION_KIND.TRANSFER]: 'credit.transferred',
  };
  const type =
    result.status === 'REJECTED'
      ? kind === OPERATION_KIND.RESERVE
        ? 'credit.reservation_rejected'
        : 'credit.order_rejected'
      : result.applied
        ? types[kind]
        : 'credit.order_succeeded';
  return {
    eventId: randomUUID(),
    type,
    occurredAt: new Date().toISOString(),
    requestId: result.requestId,
    correlationId,
    ...(result.orderId ? { orderId: result.orderId } : {}),
    data: result,
  };
}
