import { randomUUID } from 'node:crypto';
import { db, lock, type Transaction } from '../db/index.js';
import {
  OPERATION_KIND,
  RESERVATION_STATE,
  operationPayload,
  CreditError,
  MAX,
  type CreditOperation,
  type Outcome,
  type ReserveCreditsInput,
  type ReleaseCreditsInput,
  type TransferCreditsInput,
} from '../common/types.js';
import {
  readOrderHistory,
  summarizeReservation,
  type OrderHistory,
} from './reads.js';
import { lockAccounts } from './accounts.js';
import {
  findPriorOrder,
  saveOrder,
  saveMovement,
} from '../repositories/orders.js';
import { applyBalanceChanges } from '../repositories/accounts.js';
import { insertOutbox } from '../repositories/outbox.js';
import { formatOutcome, outcomeEvent } from './outcomes.js';

type Movement = {
  creditUserId: number;
  debitBucket: 'AVAILABLE' | 'RESERVED';
  creditBucket: 'AVAILABLE' | 'RESERVED';
  deltas: Outcome['deltas'];
};

type OperationResult = Pick<
  Outcome,
  'code' | 'requesterId' | 'amount' | 'reservationState' | 'courierId'
> & { movement?: Movement };

export function reserveCredits(input: ReserveCreditsInput): Promise<Outcome> {
  return executeOperation({ ...input, kind: OPERATION_KIND.RESERVE });
}

export function releaseCredits(input: ReleaseCreditsInput): Promise<Outcome> {
  return executeOperation({ ...input, kind: OPERATION_KIND.RELEASE });
}

export function transferCredits(input: TransferCreditsInput): Promise<Outcome> {
  return executeOperation({ ...input, kind: OPERATION_KIND.TRANSFER });
}

async function executeOperation(operation: CreditOperation): Promise<Outcome> {
  operation = {
    ...operation,
    requestId: operation.requestId.toLowerCase(),
    orderId: operation.orderId.toLowerCase(),
    correlationId: operation.correlationId.toLowerCase(),
  };
  return db.transaction(async (tx) => {
    await lock(tx, 'request', operation.requestId);
    const payload = operationPayload(operation);
    const prior = await findPriorOrder(tx, operation.requestId, payload);
    if (prior) {
      if (prior.kind !== operation.kind || !prior.same)
        throw new CreditError('IDEMPOTENCY_CONFLICT');
      return prior.result;
    }
    await lock(tx, 'order', operation.orderId);
    const history = await readOrderHistory(tx, operation.orderId);
    let decision: OperationResult;
    switch (operation.kind) {
      case OPERATION_KIND.RESERVE:
        decision = await reserve(tx, operation, history);
        break;
      case OPERATION_KIND.RELEASE:
        decision = await release(tx, operation, history);
        break;
      case OPERATION_KIND.TRANSFER:
        decision = await transfer(tx, operation, history);
        break;
      default: {
        const unreachable: never = operation;
        return unreachable;
      }
    }
    const { movement: plannedMovement, ...outcome } = decision;
    const movement = plannedMovement && {
      ...plannedMovement,
      transactionId: randomUUID(),
    };
    const result = formatOutcome({
      ...outcome,
      requestId: operation.requestId,
      orderId: operation.orderId,
      applied: Boolean(movement),
      transactionIds: movement ? [movement.transactionId] : [],
      deltas: movement?.deltas ?? {
        requesterTotal: 0,
        requesterReserved: 0,
        courierTotal: 0,
      },
    });
    await saveOrder(tx, {
      requestId: operation.requestId,
      kind: operation.kind,
      payload,
      orderId: operation.orderId,
      userId: result.requesterId,
      correlationId: operation.correlationId,
      result,
    });
    if (movement) {
      await applyBalanceChanges(
        tx,
        result.requesterId,
        movement.creditUserId,
        movement.deltas,
      );
      await saveMovement(tx, {
        transactionId: movement.transactionId,
        requestId: result.requestId,
        debitUserId: result.requesterId,
        creditUserId: movement.creditUserId,
        debitBucket: movement.debitBucket,
        creditBucket: movement.creditBucket,
        amount: BigInt(result.amount),
      });
    }
    await insertOutbox(
      tx,
      outcomeEvent(operation.kind, operation.correlationId, result),
    );
    return result;
  });
}

async function reserve(
  tx: Transaction,
  operation: Extract<CreditOperation, { kind: typeof OPERATION_KIND.RESERVE }>,
  history: OrderHistory,
): Promise<OperationResult> {
  const { requesterId, amount } = operation;
  const result = {
    code: 'OK',
    requesterId,
    amount,
    reservationState: summarizeReservation(history).reservationState,
  };
  const locked = await lockAccounts(tx, [requesterId], false);
  if (!locked.active) return { ...result, code: 'USER_INACTIVE' };
  const original = history.transfer ?? history.reserve ?? history.release;
  if (
    original &&
    (requesterId !== original.requesterId || amount !== original.amount)
  )
    return { ...result, code: 'RESERVATION_MISMATCH' };
  if (history.release && !history.reserve)
    return { ...result, code: 'RESERVATION_CANCELLED' };
  if (history.release || history.transfer)
    return { ...result, code: 'RESERVATION_SETTLED' };
  if (history.reserve) return result;
  const requester = locked.accounts.get(requesterId)!;
  if (requester.total_credits - requester.reserved_credits < BigInt(amount))
    return { ...result, code: 'INSUFFICIENT_CREDITS' };
  return {
    ...result,
    reservationState: RESERVATION_STATE.HELD,
    movement: {
      creditUserId: requesterId,
      debitBucket: 'AVAILABLE',
      creditBucket: 'RESERVED',
      deltas: { requesterTotal: 0, requesterReserved: amount, courierTotal: 0 },
    },
  };
}

async function release(
  tx: Transaction,
  operation: Extract<CreditOperation, { kind: typeof OPERATION_KIND.RELEASE }>,
  history: OrderHistory,
): Promise<OperationResult> {
  const { requesterId, amount } = operation;
  const result = {
    code: 'OK',
    requesterId,
    amount,
    reservationState: summarizeReservation(history).reservationState,
  };
  const locked = await lockAccounts(tx, [requesterId], true);
  if (!locked.active) return { ...result, code: 'USER_INACTIVE' };
  const original = history.transfer ?? history.reserve ?? history.release;
  if (
    original &&
    (requesterId !== original.requesterId || amount !== original.amount)
  )
    return { ...result, code: 'RESERVATION_MISMATCH' };
  if (history.transfer) return { ...result, code: 'RESERVATION_SETTLED' };
  if (history.release) return result;
  if (!history.reserve)
    return { ...result, reservationState: RESERVATION_STATE.CANCELLED };
  return {
    ...result,
    reservationState: RESERVATION_STATE.RELEASED,
    movement: {
      creditUserId: requesterId,
      debitBucket: 'RESERVED',
      creditBucket: 'AVAILABLE',
      deltas: {
        requesterTotal: 0,
        requesterReserved: -amount,
        courierTotal: 0,
      },
    },
  };
}

async function transfer(
  tx: Transaction,
  operation: Extract<CreditOperation, { kind: typeof OPERATION_KIND.TRANSFER }>,
  history: OrderHistory,
): Promise<OperationResult> {
  const original = history.transfer ?? history.reserve ?? history.release;
  if (!original) throw new CreditError('RESERVATION_NOT_READY');
  const { requesterId, amount } = original;
  const { courierId } = operation;
  const result = {
    code: 'OK',
    requesterId,
    amount,
    courierId,
    reservationState: summarizeReservation(history).reservationState,
  };
  const locked = await lockAccounts(tx, [requesterId, courierId], false);
  if (!locked.active) return { ...result, code: 'USER_INACTIVE' };
  if (courierId === requesterId) return { ...result, code: 'SELF_TRANSFER' };
  if (history.release && !history.reserve)
    return { ...result, code: 'RESERVATION_CANCELLED' };
  if (history.release) return { ...result, code: 'RESERVATION_SETTLED' };
  if (history.transfer) {
    if (courierId !== history.transfer.courierId)
      return { ...result, code: 'RESERVATION_MISMATCH' };
    return result;
  }
  const courier = locked.accounts.get(courierId)!;
  if (BigInt(amount) > MAX - courier.total_credits)
    return { ...result, code: 'BALANCE_LIMIT_EXCEEDED' };
  return {
    ...result,
    reservationState: RESERVATION_STATE.TRANSFERRED,
    movement: {
      creditUserId: courierId,
      debitBucket: 'RESERVED',
      creditBucket: 'AVAILABLE',
      deltas: {
        requesterTotal: -amount,
        requesterReserved: -amount,
        courierTotal: amount,
      },
    },
  };
}
