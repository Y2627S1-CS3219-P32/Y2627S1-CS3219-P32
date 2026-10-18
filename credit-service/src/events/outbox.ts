import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Outcome } from "../credit/types.js";

export async function enqueueOutcome(
  client: pg.PoolClient,
  kind: string,
  correlationId: string,
  result: Outcome,
) {
  const types: Record<string, string> = {
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
  await client.query(
    "INSERT INTO credit_outbox(event_id,request_id,payload) VALUES($1,$2,$3)",
    [eventId, result.requestId, JSON.stringify(payload)],
  );
}
