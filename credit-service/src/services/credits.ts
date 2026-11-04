import { randomUUID } from 'node:crypto';
import { db, lock, type Transaction } from '../db/index.js';
import {
  OPERATION_KIND,
  RESERVATION_STATE,
  operationPayload,
  formatOutcome,
  outcomeEvent,
  CreditError,
  MAX,
  type CreditOperation,
  type Outcome,
  type ReserveCreditsInput,
  type ReleaseCreditsInput,
  type TransferCreditsInput,
} from '../common/types.js';
import { lockAccounts } from './accounts.js';
import {
  findPriorOrder,
  findAppliedOperation,
  findSuccessfulOperation,
  saveOrder,
  saveMovement,
} from '../repositories/orders.js';
import { applyBalanceChanges } from '../repositories/accounts.js';
import { insertOutbox } from '../repositories/outbox.js';

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
  const { requesterId, amount } = input;
  return runCreditOperation(
    { ...input, kind: OPERATION_KIND.RESERVE },
    async (tx, orderId) => {
      const transferred = await findAppliedOperation(tx, orderId, 'TRANSFER');
      const reserved = transferred
        ? undefined
        : await findAppliedOperation(tx, orderId, 'RESERVE');
      const released = transferred
        ? undefined
        : await findSuccessfulOperation(tx, orderId, 'RELEASE');
      const result = {
        code: 'OK',
        requesterId,
        amount,
        reservationState:
          (transferred ?? released ?? reserved)?.reservationState ??
          RESERVATION_STATE.NONE,
      };
      const locked = await lockAccounts(tx, [requesterId], false);
      if (!locked.active) return { ...result, code: 'USER_INACTIVE' };
      const original = transferred ?? reserved ?? released;
      if (
        original &&
        (requesterId !== original.requesterId || amount !== original.amount)
      )
        return { ...result, code: 'RESERVATION_MISMATCH' };
      if (released && !reserved)
        return { ...result, code: 'RESERVATION_CANCELLED' };
      if (released || transferred)
        return { ...result, code: 'RESERVATION_SETTLED' };
      if (reserved) return result;
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
    },
  );
}

export function releaseCredits(input: ReleaseCreditsInput): Promise<Outcome> {
  const { requesterId, amount } = input;
  return runCreditOperation(
    { ...input, kind: OPERATION_KIND.RELEASE },
    async (tx, orderId) => {
      const transferred = await findAppliedOperation(tx, orderId, 'TRANSFER');
      const released = transferred
        ? undefined
        : await findSuccessfulOperation(tx, orderId, 'RELEASE');
      const reserved =
        transferred || released
          ? undefined
          : await findAppliedOperation(tx, orderId, 'RESERVE');
      const result = {
        code: 'OK',
        requesterId,
        amount,
        reservationState:
          (transferred ?? released ?? reserved)?.reservationState ??
          RESERVATION_STATE.NONE,
      };
      const locked = await lockAccounts(tx, [requesterId], true);
      if (!locked.active) return { ...result, code: 'USER_INACTIVE' };
      const original = transferred ?? reserved ?? released;
      if (
        original &&
        (requesterId !== original.requesterId || amount !== original.amount)
      )
        return { ...result, code: 'RESERVATION_MISMATCH' };
      if (transferred) return { ...result, code: 'RESERVATION_SETTLED' };
      if (released) return result;
      if (!reserved)
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
    },
  );
}

export function transferCredits(input: TransferCreditsInput): Promise<Outcome> {
  const { courierId } = input;
  return runCreditOperation(
    { ...input, kind: OPERATION_KIND.TRANSFER },
    async (tx, orderId) => {
      const transferred = await findAppliedOperation(tx, orderId, 'TRANSFER');
      const reserved = transferred
        ? undefined
        : await findAppliedOperation(tx, orderId, 'RESERVE');
      const released = transferred
        ? undefined
        : await findSuccessfulOperation(tx, orderId, 'RELEASE');
      const original = transferred ?? reserved ?? released;
      if (!original) throw new CreditError('RESERVATION_NOT_READY');
      const { requesterId, amount } = original;
      const result = {
        code: 'OK',
        requesterId,
        amount,
        courierId,
        reservationState:
          (transferred ?? released ?? reserved)?.reservationState ??
          RESERVATION_STATE.NONE,
      };
      const locked = await lockAccounts(tx, [requesterId, courierId], false);
      if (!locked.active) return { ...result, code: 'USER_INACTIVE' };
      if (courierId === requesterId) return { ...result, code: 'SELF_TRANSFER' };
      if (released && !reserved)
        return { ...result, code: 'RESERVATION_CANCELLED' };
      if (released) return { ...result, code: 'RESERVATION_SETTLED' };
      if (transferred) {
        if (courierId !== transferred.courierId)
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
    },
  );
}

async function runCreditOperation(
  operation: CreditOperation,
  decide: (tx: Transaction, orderId: string) => Promise<OperationResult>,
): Promise<Outcome> {
  operation = {
    ...operation,
    requestId: operation.requestId.toLowerCase(),
    orderId: operation.orderId.toLowerCase(),
    correlationId: operation.correlationId.toLowerCase(),
  };
  return db.transaction(async (tx) => {
    await lock(tx, 'request', operation.requestId);
    const payload = operationPayload(operation);
    const prior = await findPriorOrder(tx, operation.requestId);
    if (prior) {
      if (prior.orderId !== operation.orderId)
        throw new CreditError('IDEMPOTENCY_CONFLICT');
      return prior.result;
    }
    await lock(tx, 'order', operation.orderId);
    const decision = await decide(tx, operation.orderId);
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
