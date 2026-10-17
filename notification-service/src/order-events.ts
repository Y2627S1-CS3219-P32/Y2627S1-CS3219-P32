/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Routing order events to the requester's and courier's sockets on this instance.
 * Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-17: also pushes the notifications the rules produce,
 * for toasts. Author review: Pending.
 */
import { sendToUser } from "./connections.js";
import { notificationsForOrderEvent } from "./rules.js";

function userId(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

// Every order event goes to the requester and courier so open pages can refresh; the
// notifications (fewer, per the rules) are for toasts. Returns the users the event was
// delivered to.
export function routeOrderEvent(event: unknown): number[] {
  if (typeof event !== "object" || event === null) return [];
  const order = (event as Record<string, unknown>).order;
  if (typeof order !== "object" || order === null) return [];
  const { requesterId, courierId } = order as Record<string, unknown>;

  const recipients = new Set([userId(requesterId), userId(courierId)].filter((id) => id !== undefined));
  const delivered = [...recipients].filter((id) => sendToUser(id, { type: "order.event", event }) > 0);
  for (const notification of notificationsForOrderEvent(event)) {
    sendToUser(notification.userId, { type: "notification", notification });
  }
  return delivered;
}
