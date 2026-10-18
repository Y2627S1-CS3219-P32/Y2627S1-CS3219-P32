import { randomUUID } from "node:crypto";
import type pg from "pg";
import { transaction, lock } from "../db/index.js";
import { canonical, CreditError, MAX, type Command, type Outcome } from "./types.js";
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
  return transaction(async (client) => {
    await lock(client, "request", command.requestId);
    const {
      rows: [prior],
    } = await client.query(
      "SELECT kind,request_payload,result FROM credit_orders WHERE request_id=$1",
      [command.requestId],
    );
    const payload = canonical(command);
    if (prior) {
      const {
        rows: [same],
      } = await client.query(
        "SELECT request_payload=$2::jsonb AS same FROM credit_orders WHERE request_id=$1",
        [command.requestId, JSON.stringify(payload)],
      );
      if (prior.kind !== command.kind || !same.same)
        throw new CreditError(409, "IDEMPOTENCY_CONFLICT");
      return prior.result;
    }
    await lock(client, "order", command.orderId);
    const state = await readReservation(client, command.orderId);
    if (command.kind === "TRANSFER" && state.reservationState === "NONE")
      throw new CreditError(503, "RESERVATION_NOT_READY");
    const requesterId =
      command.kind === "TRANSFER" ? state.requesterId! : command.requesterId;
    const amount =
      command.kind === "TRANSFER" ? state.amount! : command.amount;
    const ids =
      command.kind === "TRANSFER"
        ? [requesterId, command.courierId]
        : [requesterId];
    const accounts = await lockAccounts(
      client,
      ids,
      command.kind === "RELEASE",
    );
    let code = "OK",
      applied = false,
      next = state.reservationState;
    if (
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
        const account = accounts.get(requesterId)!;
        if (
          BigInt(account.total_credits) - BigInt(account.reserved_credits) <
          BigInt(amount)
        )
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
          MAX - BigInt(accounts.get(command.courierId)!.total_credits)
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
      ...(command.kind === "TRANSFER"
        ? { courierId: command.courierId }
        : {}),
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
  client: pg.PoolClient,
  command: Command,
  requesterId: number,
  amount: number,
  transactionId: string,
) {
  const total = command.kind === "TRANSFER" ? -amount : 0;
  const reserved = command.kind === "RESERVE" ? amount : -amount;
  await client.query(
    "UPDATE credit_accounts SET total_credits=total_credits+$2,reserved_credits=reserved_credits+$3,updated_at=now() WHERE user_id=$1",
    [requesterId, total, reserved],
  );
  if (command.kind === "TRANSFER")
    await client.query(
      "UPDATE credit_accounts SET total_credits=total_credits+$2,updated_at=now() WHERE user_id=$1",
      [command.courierId, amount],
    );
  await client.query(
    "INSERT INTO credit_transactions(transaction_id,credit_order_request_id,debit_user_id,credit_user_id,debit_bucket,credit_bucket,amount) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      transactionId,
      command.requestId,
      requesterId,
      command.kind === "TRANSFER" ? command.courierId : requesterId,
      command.kind === "RESERVE" ? "AVAILABLE" : "RESERVED",
      command.kind === "RESERVE" ? "RESERVED" : "AVAILABLE",
      amount,
    ],
  );
}
