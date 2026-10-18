/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
 * Scope: Parsing order events (order-service/README.md) and credit results
 * (credit-service/README.md) into what the saga needs. Author review: Pending.
 */
import type { CreditResult, OrderEvent } from "./saga.js";

export class InvalidMessageError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAGA_ORDER_EVENTS = new Set(["order.created", "order.cancelled", "order.expired", "order.completed"]);

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InvalidMessageError(`${what} must be an object`);
  return value as Record<string, unknown>;
}

function uuid(value: unknown, what: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new InvalidMessageError(`${what} must be a UUID`);
  return value.toLowerCase();
}

function positiveInteger(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new InvalidMessageError(`${what} must be a positive integer`);
  return value;
}

// Undefined for order events the saga does not act on.
export function parseOrderEvent(message: unknown): OrderEvent | undefined {
  const event = record(message, "order event");
  if (typeof event.type !== "string" || !SAGA_ORDER_EVENTS.has(event.type)) return undefined;
  const order = record(event.order, "order");
  return {
    eventId: uuid(event.eventId, "eventId"),
    type: event.type as OrderEvent["type"],
    orderId: uuid(event.orderId, "orderId"),
    requesterId: positiveInteger(order.requesterId, "order.requesterId"),
    courierId: order.courierId === null || order.courierId === undefined ? null : positiveInteger(order.courierId, "order.courierId"),
    creditReward: positiveInteger(order.creditReward, "order.creditReward"),
  };
}

// Undefined for credit events that are not about an order (e.g. credit.account_allocated).
export function parseCreditResult(message: unknown): CreditResult | undefined {
  const event = record(message, "credit event");
  if (event.orderId === undefined) return undefined;
  const data = record(event.data, "data");
  if (data.status !== "SUCCEEDED" && data.status !== "REJECTED") throw new InvalidMessageError("data.status must be SUCCEEDED or REJECTED");
  return {
    eventId: uuid(event.eventId, "eventId"),
    orderId: uuid(event.orderId, "orderId"),
    requestId: uuid(event.requestId, "requestId"),
    status: data.status,
    code: typeof data.code === "string" ? data.code : "",
  };
}
