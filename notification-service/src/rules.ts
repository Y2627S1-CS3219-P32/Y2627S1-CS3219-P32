/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Who is notified about which order event (shared by the live push and the stored
 * history), and a notification id derived from (source, event id, user id) so both paths
 * agree without coordinating. Author review: Pending.
 */
import { createHash } from "node:crypto";
import type { Source } from "./db/schema.js";

export interface Notification {
  id: string;
  userId: number;
  source: Source;
  eventId: string;
  orderId: string | null;
  type: string;
  payload: { title: string; creditReward: number };
  createdAt: string;
}

// The requester hears about their order's progress; the courier about confirmation and
// payment. Edits, creation and cancellation (only possible before a courier) notify nobody.
const REQUESTER_EVENTS = new Set([
  "order.opened",
  "order.rejected",
  "order.aborted",
  "order.accepted",
  "order.picked_up",
  "order.delivered",
  "order.expired",
]);
const COURIER_EVENTS = new Set(["order.completed", "order.settled"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function notificationId(source: Source, eventId: string, userId: number): string {
  const hex = createHash("sha256").update(`${source}:${eventId}:${userId}`).digest("hex");
  // Formatted as a version 8 (custom) UUID.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

// Order events as published on order-events (order-service/README.md).
export function notificationsForOrderEvent(event: unknown): Notification[] {
  if (typeof event !== "object" || event === null) return [];
  const { eventId, type, orderId, actorId, occurredAt, order } = event as Record<string, unknown>;
  if (
    typeof eventId !== "string" || !UUID.test(eventId) ||
    typeof type !== "string" ||
    typeof orderId !== "string" || !UUID.test(orderId) ||
    typeof occurredAt !== "string" || Number.isNaN(Date.parse(occurredAt)) ||
    typeof order !== "object" || order === null
  ) {
    return [];
  }
  const { requesterId, courierId, title, creditReward } = order as Record<string, unknown>;

  const recipients: number[] = [];
  const requester = positiveInteger(requesterId);
  const courier = positiveInteger(courierId);
  if (requester && REQUESTER_EVENTS.has(type)) recipients.push(requester);
  if (courier && COURIER_EVENTS.has(type)) recipients.push(courier);

  const actor = positiveInteger(actorId);
  return recipients
    .filter((userId) => userId !== actor) // nobody is told about their own action
    .map((userId) => ({
      id: notificationId("order", eventId.toLowerCase(), userId),
      userId,
      source: "order" as const,
      eventId: eventId.toLowerCase(),
      orderId: orderId.toLowerCase(),
      type,
      payload: {
        title: typeof title === "string" ? title : "Your order",
        creditReward: typeof creditReward === "number" ? creditReward : 0,
      },
      createdAt: new Date(occurredAt).toISOString(),
    }));
}
