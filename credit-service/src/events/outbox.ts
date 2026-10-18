import { randomUUID } from "node:crypto";
import type { Transaction } from "../db/index.js";
import { creditOrders, creditOutbox } from "../db/schema.js";
import type { Outcome } from "../credit/types.js";

export async function enqueueOutcome(
  client: Transaction,
  kind: typeof creditOrders.$inferInsert.kind,
  correlationId: string,
  result: Outcome,
) {
  const types = {
    ALLOCATE: "credit.account_allocated",
    RESERVE: "credit.reserved",
    RELEASE: "credit.released",
    TRANSFER: "credit.transferred",
  };
  const type =
    result.status === "REJECTED"
      ? kind === "RESERVE"
        ? "credit.reservation_rejected"
        : "credit.order_rejected"
      : result.applied
        ? types[kind]
        : "credit.order_succeeded";
  const eventId = randomUUID();
  const payload = {
    eventId,
    type,
    occurredAt: new Date().toISOString(),
    requestId: result.requestId,
    correlationId,
    ...(result.orderId ? { orderId: result.orderId } : {}),
    data: result,
  };
  await client.insert(creditOutbox).values({
    event_id: eventId,
    request_id: result.requestId,
    payload,
  });
}
