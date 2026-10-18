import { and, eq } from "drizzle-orm";
import { db, type Database, type Transaction } from "../db/index.js";
import {
  creditAccounts,
  creditOrders,
  creditTransactions,
} from "../db/schema.js";
import { CreditError, money, type Reservation } from "./types.js";

export async function balance(userId: number) {
  const [account] = await db
    .select()
    .from(creditAccounts)
    .where(eq(creditAccounts.user_id, userId));
  if (!account) throw new CreditError(503, "ACCOUNT_PENDING");
  if (account.deleted_at) throw new CreditError(401, "USER_INACTIVE");
  return {
    totalCredits: money(account.total_credits),
    reservedCredits: money(account.reserved_credits),
    availableCredits: money(
      account.total_credits - account.reserved_credits,
    ),
  };
}
export async function lookup(requestId: string) {
  const [row] = await db
    .select()
    .from(creditOrders)
    .where(eq(creditOrders.request_id, requestId));
  if (!row) throw new CreditError(404, "OPERATION_NOT_FOUND");
  return {
    ...row,
    initial_grant: row.initial_grant === null ? null : money(row.initial_grant),
  };
}
export async function reservation(orderId: string) {
  const state = await readReservation(db, orderId);
  if (state.reservationState === "NONE")
    throw new CreditError(404, "RESERVATION_NOT_FOUND");
  return state;
}
export async function readReservation(
  client: Database | Transaction,
  orderId: string,
): Promise<Reservation> {
  const rows = await client
    .select({
      kind: creditOrders.kind,
      request_payload: creditOrders.request_payload,
      debit_user_id: creditTransactions.debit_user_id,
      credit_user_id: creditTransactions.credit_user_id,
      amount: creditTransactions.amount,
    })
    .from(creditOrders)
    .leftJoin(
      creditTransactions,
      eq(creditTransactions.credit_order_request_id, creditOrders.request_id),
    )
    .where(
      and(
        eq(creditOrders.order_id, orderId),
        eq(creditOrders.status, "SUCCEEDED"),
      ),
    );
  const reserve = rows.find(
    (row) => row.kind === "RESERVE" && row.amount !== null,
  );
  const transfer = rows.find(
    (row) => row.kind === "TRANSFER" && row.amount !== null,
  );
  const release = rows.find((row) => row.kind === "RELEASE");
  if (transfer && release) throw new Error("Contradictory settlement history");
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
  if (
    release &&
    "kind" in release.request_payload &&
    release.request_payload.kind === "RELEASE"
  )
    return {
      reservationState: "CANCELLED",
      requesterId: release.request_payload.requesterId,
      amount: release.request_payload.amount,
    };
  return { reservationState: "NONE" };
}
