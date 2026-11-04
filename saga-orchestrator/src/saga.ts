/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
 * Scope: The student-designed order/credit saga. order.created reserves the reward
 * (credit.reserve), then opens or rejects the order; a reservation credit does not answer
 * in time aborts the order and releases; cancelled or expired orders release; completed
 * orders transfer the reward to the courier, then settle. Each step locks the saga row and
 * writes its commands to the outbox in the same transaction; redelivered events change
 * nothing. Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-18: wait for the publish before returning. Author review: Pending.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, lte } from "drizzle-orm";
import { config } from "./config.js";
import { db, type Transaction } from "./db/index.js";
import { outbox, processedMessages, sagas, type SagaState } from "./db/schema.js";
import { requestPublish } from "./outbox.js";

type Saga = typeof sagas.$inferSelect;

export interface OrderEvent {
  eventId: string;
  type: "order.created" | "order.cancelled" | "order.expired" | "order.completed";
  orderId: string;
  requesterId: number;
  courierId: number | null;
  creditReward: number;
}

export interface CreditResult {
  eventId: string;
  orderId: string;
  requestId: string;
  status: "SUCCEEDED" | "REJECTED";
  code: string;
}

export type Outcome = "applied" | "duplicate" | "ignored";

// Records the message id; false if it was already handled.
async function firstTime(tx: Transaction, messageId: string): Promise<boolean> {
  const inserted = await tx.insert(processedMessages).values({ messageId }).onConflictDoNothing()
    .returning({ messageId: processedMessages.messageId });
  return inserted.length > 0;
}

async function lockSaga(tx: Transaction, orderId: string): Promise<Saga | undefined> {
  const [saga] = await tx.select().from(sagas).where(eq(sagas.orderId, orderId)).for("update");
  return saga;
}

async function setState(tx: Transaction, saga: Saga, state: SagaState, changes: Partial<Saga> = {}): Promise<Saga> {
  const [updated] = await tx.update(sagas).set({ ...changes, state }).where(eq(sagas.orderId, saga.orderId)).returning();
  if (!updated) throw new Error("Locked saga could not be updated");
  return updated;
}

// order-commands, as order-service expects: { commandId, type, orderId }.
async function orderCommand(tx: Transaction, orderId: string, type: "OpenOrder" | "RejectOrder" | "AbortOrder" | "SettleOrder") {
  await tx.insert(outbox).values({
    topic: config.pubsub.orderCommandsTopic,
    orderingKey: orderId,
    type,
    payload: { commandId: randomUUID(), type, orderId },
  });
}

// credit-commands, as credit-service expects (credit-service/README.md).
async function creditCommand(
  tx: Transaction,
  saga: Saga,
  type: "credit.reserve" | "credit.release" | "credit.transfer",
  requestId: string,
  fields: Record<string, unknown>,
) {
  await tx.insert(outbox).values({
    topic: config.pubsub.creditCommandsTopic,
    orderingKey: saga.orderId,
    type,
    payload: { type, requestId, correlationId: saga.correlationId, orderId: saga.orderId, ...fields },
  });
}

async function release(tx: Transaction, saga: Saga, state: "RELEASING" | "ABORTED", reason: string): Promise<Saga> {
  const releaseRequestId = randomUUID();
  const updated = await setState(tx, saga, state, { releaseRequestId, reserveDeadline: null });
  await creditCommand(tx, updated, "credit.release", releaseRequestId, {
    requesterId: saga.requesterId,
    amount: saga.amount,
    reason,
  });
  return updated;
}

async function commit(work: (tx: Transaction) => Promise<Outcome>): Promise<Outcome> {
  const outcome = await db.transaction(work);
  if (outcome === "applied") await requestPublish();
  return outcome;
}

export function handleOrderEvent(event: OrderEvent): Promise<Outcome> {
  return commit(async (tx) => {
    if (!await firstTime(tx, event.eventId)) return "duplicate";

    if (event.type === "order.created") {
      const reserveRequestId = randomUUID();
      const [saga] = await tx.insert(sagas).values({
        orderId: event.orderId,
        requesterId: event.requesterId,
        amount: event.creditReward,
        state: "RESERVING",
        reserveRequestId,
        reserveDeadline: new Date(Date.now() + config.reserveTimeoutSeconds * 1000),
      }).onConflictDoNothing().returning();
      if (!saga) return "ignored";
      await creditCommand(tx, saga, "credit.reserve", reserveRequestId, { requesterId: saga.requesterId, amount: saga.amount });
      return "applied";
    }

    const saga = await lockSaga(tx, event.orderId);
    if (!saga) return "ignored";

    if (event.type === "order.cancelled" || event.type === "order.expired") {
      // Cancelling while credit is still reserving is safe: a release that reaches credit
      // first cancels the reservation, and the late reserve is refused.
      if (saga.state !== "RESERVING" && saga.state !== "OPEN") return "ignored";
      await release(tx, saga, "RELEASING", event.type === "order.cancelled" ? "Order cancelled" : "Order expired");
      return "applied";
    }

    // order.completed: pay the courier.
    if (saga.state !== "OPEN" || event.courierId === null) return "ignored";
    const transferRequestId = randomUUID();
    const updated = await setState(tx, saga, "TRANSFERRING", { transferRequestId, courierId: event.courierId });
    await creditCommand(tx, updated, "credit.transfer", transferRequestId, { courierId: event.courierId });
    return "applied";
  });
}

export function handleCreditResult(result: CreditResult): Promise<Outcome> {
  return commit(async (tx) => {
    if (!await firstTime(tx, result.eventId)) return "duplicate";
    const saga = await lockSaga(tx, result.orderId);
    if (!saga) return "ignored";
    const succeeded = result.status === "SUCCEEDED";

    if (result.requestId === saga.reserveRequestId) {
      // After an abort or cancel, the release already sent takes care of any held credits.
      if (saga.state !== "RESERVING") return "ignored";
      if (succeeded) {
        await setState(tx, saga, "OPEN", { reserveDeadline: null });
        await orderCommand(tx, saga.orderId, "OpenOrder");
      } else {
        await setState(tx, saga, "REJECTED", { reserveDeadline: null, failureCode: result.code });
        await orderCommand(tx, saga.orderId, "RejectOrder");
      }
      return "applied";
    }

    if (result.requestId === saga.releaseRequestId) {
      if (saga.state !== "RELEASING" && saga.state !== "ABORTED") return "ignored";
      await setState(tx, saga, succeeded ? "RELEASED" : "FAILED", succeeded ? {} : { failureCode: result.code });
      if (!succeeded) console.error(`[saga-orchestrator] Release for ${saga.orderId} was rejected: ${result.code}`);
      return "applied";
    }

    if (result.requestId === saga.transferRequestId) {
      if (saga.state !== "TRANSFERRING") return "ignored";
      if (succeeded) {
        await setState(tx, saga, "SETTLED");
        await orderCommand(tx, saga.orderId, "SettleOrder");
      } else {
        await setState(tx, saga, "FAILED", { failureCode: result.code });
        console.error(`[saga-orchestrator] Transfer for ${saga.orderId} was rejected: ${result.code}`);
      }
      return "applied";
    }

    return "ignored";
  });
}

const BATCH = 100;

// Reservations credit has not answered in time: abort the order and release, in case the
// reserve went through after all. Called every minute (Cloud Scheduler / local ticker).
export async function abortOverdueReservations(now = new Date()): Promise<number> {
  let total = 0;
  for (;;) {
    const count = await db.transaction(async (tx) => {
      const overdue = await tx.select().from(sagas)
        .where(and(eq(sagas.state, "RESERVING"), lte(sagas.reserveDeadline, now)))
        .orderBy(asc(sagas.reserveDeadline)).limit(BATCH)
        .for("update", { skipLocked: true });
      for (const saga of overdue) {
        await release(tx, saga, "ABORTED", "Credit reservation timed out");
        await orderCommand(tx, saga.orderId, "AbortOrder");
      }
      return overdue.length;
    });
    total += count;
    if (count < BATCH) break;
  }
  if (total > 0) await requestPublish();
  return total;
}
