import type pg from "pg";
import { pool } from "../db/index.js";
import { CreditError, money, type Account, type Reservation } from "./types.js";

export async function balance(userId: number) {
  const {
    rows: [account],
  } = await pool.query<Account>(
    "SELECT * FROM credit_accounts WHERE user_id=$1",
    [userId],
  );
  if (!account) throw new CreditError(503, "ACCOUNT_PENDING");
  if (account.deleted_at) throw new CreditError(401, "USER_INACTIVE");
  return {
    totalCredits: money(account.total_credits),
    reservedCredits: money(account.reserved_credits),
    availableCredits: money(
      BigInt(account.total_credits) - BigInt(account.reserved_credits),
    ),
  };
}
export async function lookup(requestId: string) {
  const {
    rows: [row],
  } = await pool.query("SELECT * FROM credit_orders WHERE request_id=$1", [
    requestId,
  ]);
  if (!row) throw new CreditError(404, "OPERATION_NOT_FOUND");
  return {
    ...row,
    initial_grant:
      row.initial_grant === null ? null : money(row.initial_grant),
  };
}
export async function reservation(orderId: string) {
  const state = await readReservation(pool, orderId);
  if (state.reservationState === "NONE")
    throw new CreditError(404, "RESERVATION_NOT_FOUND");
  return state;
}
export async function readReservation(
  client: Pick<pg.PoolClient, "query">,
  orderId: string,
): Promise<Reservation> {
  const { rows } = await client.query<{
    kind: string;
    request_payload: { requesterId?: number; amount?: number };
    debit_user_id: number | null;
    credit_user_id: number | null;
    amount: string | null;
  }>(
    `SELECT o.kind,o.request_payload,t.debit_user_id,t.credit_user_id,t.amount FROM credit_orders o LEFT JOIN credit_transactions t ON t.credit_order_request_id=o.request_id WHERE o.order_id=$1 AND o.status='SUCCEEDED'`,
    [orderId],
  );
  const reserve = rows.find(
    (row) => row.kind === "RESERVE" && row.amount !== null,
  );
  const transfer = rows.find(
    (row) => row.kind === "TRANSFER" && row.amount !== null,
  );
  const release = rows.find((row) => row.kind === "RELEASE");
  if (transfer && release)
    throw new Error("Contradictory settlement history");
  if (transfer)
    return {
      reservationState: "TRANSFERRED",
      requesterId: transfer.debit_user_id!,
      amount: money(transfer.amount!),
      courierId: transfer.credit_user_id!,
    };
  if (reserve)
    return {
      reservationState: release ? "RELEASED" : "HELD",
      requesterId: reserve.debit_user_id!,
      amount: money(reserve.amount!),
    };
  if (release)
    return {
      reservationState: "CANCELLED",
      requesterId: release.request_payload.requesterId!,
      amount: release.request_payload.amount!,
    };
  return { reservationState: "NONE" };
}
