import { OPERATION_KIND, RESERVATION_STATE } from "../common/constants.js";
import { db, type Database, type Transaction } from "../db/index.js";
import { findAccount } from "../repositories/accounts.js";
import { findOrder, findHistory } from "../repositories/orders.js";
import { CreditError, money, type Reservation } from "../common/types.js";

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
export async function getCreditOperation(requestId: string) {
  const row = await findOrder(db, requestId);
  if (!row) throw new CreditError("OPERATION_NOT_FOUND");
  return {
    ...row,
    initial_grant: row.initial_grant === null ? null : money(row.initial_grant),
  };
}
export async function getReservation(orderId: string) {
  const state = summarizeReservation(await readOrderHistory(db, orderId));
  if (state.reservationState === RESERVATION_STATE.NONE)
    throw new CreditError("RESERVATION_NOT_FOUND");
  return state;
}
export async function readOrderHistory(
  db: Database | Transaction,
  orderId: string,
) {
  const rows = await findHistory(db, orderId);
  const reserveRow = rows.find(
    (row) => row.kind === OPERATION_KIND.RESERVE && row.amount !== null,
  );
  const transferRow = rows.find(
    (row) => row.kind === OPERATION_KIND.TRANSFER && row.amount !== null,
  );
  const releaseRow = rows.find((row) => row.kind === OPERATION_KIND.RELEASE);
  if (transferRow && releaseRow)
    throw new Error("Contradictory settlement history");
  const reserve =
    reserveRow?.amount != null && reserveRow.debit_user_id !== null
      ? {
          requesterId: reserveRow.debit_user_id,
          amount: money(reserveRow.amount),
        }
      : undefined;
  const transfer =
    transferRow?.amount != null &&
    transferRow.debit_user_id !== null &&
    transferRow.credit_user_id !== null
      ? {
          requesterId: transferRow.debit_user_id,
          amount: money(transferRow.amount),
          courierId: transferRow.credit_user_id,
        }
      : undefined;
  const payload = releaseRow?.request_payload;
  const release =
    releaseRow && reserve
      ? reserve
      : payload && "kind" in payload && payload.kind === OPERATION_KIND.RELEASE
        ? { requesterId: payload.requesterId, amount: payload.amount }
        : undefined;
  return { reserve, release, transfer };
}

export type OrderHistory = Awaited<ReturnType<typeof readOrderHistory>>;

export function summarizeReservation({
  reserve,
  release,
  transfer,
}: OrderHistory): Reservation {
  if (transfer)
    return {
      reservationState: RESERVATION_STATE.TRANSFERRED,
      ...transfer,
    };
  if (reserve)
    return {
      reservationState: release
        ? RESERVATION_STATE.RELEASED
        : RESERVATION_STATE.HELD,
      ...reserve,
    };
  if (release)
    return {
      reservationState: RESERVATION_STATE.CANCELLED,
      ...release,
    };
  return { reservationState: RESERVATION_STATE.NONE };
}
