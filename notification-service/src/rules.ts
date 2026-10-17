/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Who is notified about which order event (shared by the live push and the stored
 * history), and a notification id derived from (source, event id, user id) so both paths
 * agree without coordinating. Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-17: group orders (members hear what the requester hears,
 * plus joins, placing and cancelling). Author review: Pending.
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
  payload: { title: string; creditReward: number; group: boolean; memberName?: string | null };
  createdAt: string;
}

// The requester (and, for group orders, every member) hears about the order's progress;
// the courier about confirmation and payment. Creation, placing and cancelling are done by
// the requester, so for normal orders they notify nobody; group members are told.
const REQUESTER_EVENTS = new Set([
  "order.member_joined",
  "order.created",
  "order.cancelled",
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
  const { requesterId, courierId, title, creditReward, isGroupOrder, memberIds } = order as Record<string, unknown>;

  const recipients = new Set<number>();
  const requester = positiveInteger(requesterId);
  const courier = positiveInteger(courierId);
  if (REQUESTER_EVENTS.has(type)) {
    if (requester) recipients.add(requester);
    for (const id of Array.isArray(memberIds) ? memberIds : []) {
      const member = positiveInteger(id);
      if (member) recipients.add(member);
    }
  }
  if (courier && COURIER_EVENTS.has(type)) recipients.add(courier);

  // order.member_joined carries the new member in the order payload.
  const joined = (order as Record<string, unknown>).member;
  const memberName = type === "order.member_joined" && typeof joined === "object" && joined !== null
    ? (joined as Record<string, unknown>).displayName
    : undefined;

  const actor = positiveInteger(actorId);
  return [...recipients]
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
        group: isGroupOrder === true,
        ...(memberName === undefined ? {} : { memberName: typeof memberName === "string" ? memberName : null }),
      },
      createdAt: new Date(occurredAt).toISOString(),
    }));
}
