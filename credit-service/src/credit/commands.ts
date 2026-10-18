import { COMMAND_KIND, RESERVATION_STATE } from "./constants.js";
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
  type Account,
  type Command,
  type Outcome,
  type Reservation,
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
    if (
      command.kind === COMMAND_KIND.TRANSFER &&
      state.reservationState === RESERVATION_STATE.NONE
    )
      throw new CreditError(503, "RESERVATION_NOT_READY");
    const requesterId =
      command.kind === COMMAND_KIND.TRANSFER
        ? state.requesterId!
        : command.requesterId;
    const amount =
      command.kind === COMMAND_KIND.TRANSFER ? state.amount! : command.amount;
    const ids =
      command.kind === COMMAND_KIND.TRANSFER
        ? [requesterId, command.courierId]
        : [requesterId];
    const locked = await lockAccounts(
      client,
      ids,
      command.kind === COMMAND_KIND.RELEASE,
    );
    let decision: Decision;
    if (!locked.active)
      decision = {
        code: "USER_INACTIVE",
        applied: false,
        reservationState: state.reservationState,
      };
    else if (
      state.requesterId !== undefined &&
      (requesterId !== state.requesterId || amount !== state.amount)
    )
      decision = {
        code: "RESERVATION_MISMATCH",
        applied: false,
        reservationState: state.reservationState,
      };
    else if (
      command.kind === COMMAND_KIND.TRANSFER &&
      command.courierId === requesterId
    )
      decision = {
        code: "SELF_TRANSFER",
        applied: false,
        reservationState: state.reservationState,
      };
    else if (command.kind === COMMAND_KIND.RESERVE)
      decision = handleReserve(
        command,
        state,
        locked.accounts.get(requesterId)!,
      );
    else if (command.kind === COMMAND_KIND.RELEASE)
      decision = handleRelease(state);
    else
      decision = handleTransfer(
        command,
        state,
        locked.accounts.get(command.courierId)!,
        amount,
      );
    const { code, applied, reservationState: next } = decision;
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
      ...(command.kind === COMMAND_KIND.TRANSFER
        ? { courierId: command.courierId }
        : {}),
      deltas: {
        requesterTotal:
          applied && command.kind === COMMAND_KIND.TRANSFER ? -amount : 0,
        requesterReserved: applied
          ? command.kind === COMMAND_KIND.RESERVE
            ? amount
            : -amount
          : 0,
        courierTotal:
          applied && command.kind === COMMAND_KIND.TRANSFER ? amount : 0,
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

type Decision = Pick<Outcome, "code" | "applied" | "reservationState">;

function handleReserve(
  command: Extract<Command, { kind: typeof COMMAND_KIND.RESERVE }>,
  state: Reservation,
  requester: Account,
): Decision {
  const unchanged = {
    code: "OK",
    applied: false,
    reservationState: state.reservationState,
  };
  if (state.reservationState === RESERVATION_STATE.CANCELLED)
    return { ...unchanged, code: "RESERVATION_CANCELLED" };
  if (
    state.reservationState === RESERVATION_STATE.RELEASED ||
    state.reservationState === RESERVATION_STATE.TRANSFERRED
  )
    return { ...unchanged, code: "RESERVATION_SETTLED" };
  if (state.reservationState !== RESERVATION_STATE.NONE) return unchanged;
  if (
    requester.total_credits - requester.reserved_credits <
    BigInt(command.amount)
  )
    return { ...unchanged, code: "INSUFFICIENT_CREDITS" };
  return {
    code: "OK",
    applied: true,
    reservationState: RESERVATION_STATE.HELD,
  };
}

function handleRelease(state: Reservation): Decision {
  const unchanged = {
    code: "OK",
    applied: false,
    reservationState: state.reservationState,
  };
  if (state.reservationState === RESERVATION_STATE.TRANSFERRED)
    return { ...unchanged, code: "RESERVATION_SETTLED" };
  if (state.reservationState === RESERVATION_STATE.NONE)
    return { ...unchanged, reservationState: RESERVATION_STATE.CANCELLED };
  if (state.reservationState === RESERVATION_STATE.HELD)
    return {
      code: "OK",
      applied: true,
      reservationState: RESERVATION_STATE.RELEASED,
    };
  return unchanged;
}

function handleTransfer(
  command: Extract<Command, { kind: typeof COMMAND_KIND.TRANSFER }>,
  state: Reservation,
  courier: Account,
  amount: number,
): Decision {
  const unchanged = {
    code: "OK",
    applied: false,
    reservationState: state.reservationState,
  };
  if (state.reservationState === RESERVATION_STATE.CANCELLED)
    return { ...unchanged, code: "RESERVATION_CANCELLED" };
  if (state.reservationState === RESERVATION_STATE.RELEASED)
    return { ...unchanged, code: "RESERVATION_SETTLED" };
  if (
    state.reservationState === RESERVATION_STATE.TRANSFERRED &&
    command.courierId !== state.courierId
  )
    return { ...unchanged, code: "RESERVATION_MISMATCH" };
  if (state.reservationState !== RESERVATION_STATE.HELD) return unchanged;
  if (BigInt(amount) > MAX - courier.total_credits)
    return { ...unchanged, code: "BALANCE_LIMIT_EXCEEDED" };
  return {
    code: "OK",
    applied: true,
    reservationState: RESERVATION_STATE.TRANSFERRED,
  };
}

async function move(
  client: Transaction,
  command: Command,
  requesterId: number,
  amount: number,
  transactionId: string,
) {
  const total = command.kind === COMMAND_KIND.TRANSFER ? -amount : 0;
  const reserved = command.kind === COMMAND_KIND.RESERVE ? amount : -amount;
  await client
    .update(creditAccounts)
    .set({
      total_credits: sql`${creditAccounts.total_credits} + ${BigInt(total)}`,
      reserved_credits: sql`${creditAccounts.reserved_credits} + ${BigInt(reserved)}`,
      updated_at: sql`now()`,
    })
    .where(eq(creditAccounts.user_id, requesterId));
  if (command.kind === COMMAND_KIND.TRANSFER)
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
      command.kind === COMMAND_KIND.TRANSFER ? command.courierId : requesterId,
    debit_bucket:
      command.kind === COMMAND_KIND.RESERVE ? "AVAILABLE" : "RESERVED",
    credit_bucket:
      command.kind === COMMAND_KIND.RESERVE ? "RESERVED" : "AVAILABLE",
    amount: BigInt(amount),
  });
}
