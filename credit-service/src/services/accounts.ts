import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { db, lock, type Transaction } from '../db/index.js';
import {
  RESERVATION_STATE,
  CreditError,
  MAX,
  money,
  formatOutcome,
  outcomeEvent,
  type Account,
} from '../common/types.js';
import {
  findAccount,
  lockAccount,
  createAccount,
  markDeleted,
} from '../repositories/accounts.js';
import {
  findOrder,
  hasAllocation,
  saveOrder,
  saveMovement,
} from '../repositories/orders.js';
import { insertOutbox } from '../repositories/outbox.js';

export async function getBalance(userId: number) {
  const account = await findAccount(db, userId);
  if (!account) throw new CreditError("ACCOUNT_PENDING");
  if (account.deleted_at) throw new CreditError("USER_INACTIVE");
  return {
    totalCredits: money(account.total_credits),
    reservedCredits: money(account.reserved_credits),
    availableCredits: money(account.total_credits - account.reserved_credits),
  };
}

export function validateInitialCredits(initialCredits: bigint) {
  if (initialCredits <= 0n || initialCredits > MAX)
    throw new Error('INITIAL_CREDITS is outside safe integer bounds');
}

export async function lockAccounts(
  tx: Transaction,
  ids: number[],
  allowDeleted: boolean,
): Promise<
  { active: true; accounts: Map<number, Account> } | { active: false }
> {
  const accounts = new Map<number, Account>();
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    const account = await lockAccount(tx, id);
    if (!account) throw new CreditError('ACCOUNT_PENDING');
    if (
      account.deleted_at &&
      !(allowDeleted && (await hasAllocation(tx, id)))
    )
      return { active: false };
    accounts.set(id, account);
  }
  return { active: true, accounts };
}

type AccountRequest = { requestId: string; userId: number };

export async function initializeAccount({ requestId, userId }: AccountRequest) {
  const initialCredits = config.initialCredits;
  validateInitialCredits(initialCredits);
  requestId = requestId.toLowerCase();
  await db.transaction(async (tx) => {
    await lock(tx, 'request', requestId);
    await lock(tx, 'account', userId);
    if (await findAccount(tx, userId)) return;
    if (await findOrder(tx, requestId))
      throw new CreditError('IDEMPOTENCY_CONFLICT');
    await createAccount(tx, userId, initialCredits);
    const transactionId = randomUUID();
    const amount = money(initialCredits);
    const result = formatOutcome({
      requestId,
      code: 'OK',
      reservationState: RESERVATION_STATE.NONE,
      applied: true,
      transactionIds: [transactionId],
      requesterId: userId,
      amount,
      deltas: {
        requesterTotal: amount,
        requesterReserved: 0,
        courierTotal: 0,
      },
    });
    await saveOrder(tx, {
      requestId,
      kind: 'ALLOCATE',
      payload: { userId },
      userId,
      correlationId: requestId,
      result,
      grant: initialCredits,
    });
    await saveMovement(tx, {
      transactionId,
      requestId,
      creditUserId: userId,
      debitBucket: 'ISSUANCE',
      creditBucket: 'AVAILABLE',
      amount: initialCredits,
    });
    await insertOutbox(tx, outcomeEvent('ALLOCATE', requestId, result));
  });
}

export async function deactivateAccount({ requestId, userId }: AccountRequest) {
  await db.transaction(async (tx) => {
    await lock(tx, 'request', requestId.toLowerCase());
    await lock(tx, 'account', userId);
    await markDeleted(tx, userId);
  });
}
