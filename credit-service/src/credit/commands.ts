import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, lock, type Transaction } from "../db/index.js";
import {
  creditAccounts,
  creditOrders,
  creditTransactions,
} from "../db/schema.js";
import {
  canonical,
  CreditError,
  MAX,
  type Command,
  type Outcome,
} from "./types.js";
import { readReservation } from "./queries.js";
import { lockAccounts } from "./accounts.js";
import { saveOrder } from "./orders.js";
import { enqueueOutcome } from "../events/outbox.js";

export async function execute(command: Command): Promise<Outcome> {
  command = {
    ...command,
    requestId: command.requestId.toLowerCase(),
    orderId: command.orderId.toLowerCase(),
    correlationId: command.correlationId.toLowerCase(),
  };
  return db.transaction(async (client) => {
    await lock(client, "request", command.requestId);
    const payload = canonical(command);
    const [prior] = await client
      .select({
        kind: creditOrders.kind,
        result: creditOrders.result,
        same: sql<boolean>`${creditOrders.request_payload} = ${JSON.stringify(payload)}::jsonb`,
      })
      .from(creditOrders)
      .where(eq(creditOrders.request_id, command.requestId));
    if (prior) {
      if (prior.kind !== command.kind || !prior.same)
        throw new CreditError(409, "IDEMPOTENCY_CONFLICT");
      return prior.result;
    }
    await lock(client, "order", command.orderId);
    const state = await readReservation(client, command.orderId);
    if (command.kind === "TRANSFER" && state.reservationState === "NONE")
      throw new CreditError(503, "RESERVATION_NOT_READY");
    const requesterId =
      command.kind === "TRANSFER" ? state.requesterId! : command.requesterId;
    const amount = command.kind === "TRANSFER" ? state.amount! : command.amount;
    const ids =
      command.kind === "TRANSFER"
        ? [requesterId, command.courierId]
        : [requesterId];
    const locked = await lockAccounts(client, ids, command.kind === "RELEASE");
    let code = "OK",
      applied = false,
      next = state.reservationState;
    if (!locked.active) code = "USER_INACTIVE";
    else if (
      state.requesterId !== undefined &&
      (requesterId !== state.requesterId || amount !== state.amount)
    )
      code = "RESERVATION_MISMATCH";
    else if (command.kind === "TRANSFER" && command.courierId === requesterId)
      code = "SELF_TRANSFER";
    else if (command.kind === "RESERVE") {
      if (state.reservationState === "CANCELLED")
        code = "RESERVATION_CANCELLED";
      else if (["RELEASED", "TRANSFERRED"].includes(state.reservationState))
        code = "RESERVATION_SETTLED";
      else if (state.reservationState === "NONE") {
        const account = locked.accounts.get(requesterId)!;
        if (account.total_credits - account.reserved_credits < BigInt(amount))
          code = "INSUFFICIENT_CREDITS";
        else {
          applied = true;
          next = "HELD";
        }
      }
    } else if (command.kind === "RELEASE") {
      if (state.reservationState === "TRANSFERRED")
        code = "RESERVATION_SETTLED";
      else if (state.reservationState === "NONE") next = "CANCELLED";
      else if (state.reservationState === "HELD") {
        applied = true;
        next = "RELEASED";
      }
    } else {
      if (state.reservationState === "CANCELLED")
        code = "RESERVATION_CANCELLED";
      else if (state.reservationState === "RELEASED")
        code = "RESERVATION_SETTLED";
      else if (
        state.reservationState === "TRANSFERRED" &&
        command.courierId !== state.courierId
      )
        code = "RESERVATION_MISMATCH";
      else if (state.reservationState === "HELD") {
        if (
          BigInt(amount) >
          MAX - locked.accounts.get(command.courierId)!.total_credits
        )
          code = "BALANCE_LIMIT_EXCEEDED";
        else {
          applied = true;
          next = "TRANSFERRED";
        }
      }
    }
    const result: Outcome = {
      requestId: command.requestId,
      status: code === "OK" ? "SUCCEEDED" : "REJECTED",
      httpStatus: code === "OK" ? 200 : 409,
      code,
      orderId: command.orderId,
      reservationState: next,
      applied,
      transactionIds: applied ? [randomUUID()] : [],
      requesterId,
      amount,
      ...(command.kind === "TRANSFER" ? { courierId: command.courierId } : {}),
      deltas: {
        requesterTotal: applied && command.kind === "TRANSFER" ? -amount : 0,
        requesterReserved: applied
          ? command.kind === "RESERVE"
            ? amount
            : -amount
          : 0,
        courierTotal: applied && command.kind === "TRANSFER" ? amount : 0,
      },
    };
    await saveOrder(client, {
      requestId: command.requestId,
      kind: command.kind,
      payload,
      orderId: command.orderId,
      userId: requesterId,
      correlationId: command.correlationId,
      result,
    });
    if (applied)
      await move(
        client,
        command,
        requesterId,
        amount,
        result.transactionIds[0]!,
      );
    await enqueueOutcome(client, command.kind, command.correlationId, result);
    return result;
  });
}

async function move(
  client: Transaction,
  command: Command,
  requesterId: number,
  amount: number,
  transactionId: string,
) {
  const total = command.kind === "TRANSFER" ? -amount : 0;
  const reserved = command.kind === "RESERVE" ? amount : -amount;
  await client
    .update(creditAccounts)
    .set({
      total_credits: sql`${creditAccounts.total_credits} + ${BigInt(total)}`,
      reserved_credits: sql`${creditAccounts.reserved_credits} + ${BigInt(reserved)}`,
      updated_at: sql`now()`,
    })
    .where(eq(creditAccounts.user_id, requesterId));
  if (command.kind === "TRANSFER")
    await client
      .update(creditAccounts)
      .set({
        total_credits: sql`${creditAccounts.total_credits} + ${BigInt(amount)}`,
        updated_at: sql`now()`,
      })
      .where(eq(creditAccounts.user_id, command.courierId));
  await client.insert(creditTransactions).values({
    transaction_id: transactionId,
    credit_order_request_id: command.requestId,
    debit_user_id: requesterId,
    credit_user_id:
      command.kind === "TRANSFER" ? command.courierId : requesterId,
    debit_bucket: command.kind === "RESERVE" ? "AVAILABLE" : "RESERVED",
    credit_bucket: command.kind === "RESERVE" ? "RESERVED" : "AVAILABLE",
    amount: BigInt(amount),
  });
}
