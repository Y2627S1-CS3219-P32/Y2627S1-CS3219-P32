// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
// Scope: The sentence shown for each notification type. Author review: Pending.
import type { AppNotification } from "#shared/services/notification-service/types";

export function notificationText({ type, payload }: AppNotification): string {
  const title = `“${payload.title}”`;
  switch (type) {
    case "order.opened": return `Your order ${title} is now open for couriers.`;
    case "order.rejected": return `Your order ${title} was rejected: not enough credits.`;
    case "order.aborted": return `Your order ${title} could not be created.`;
    case "order.accepted": return `Your order ${title} was accepted by a courier.`;
    case "order.picked_up": return `Your order ${title} has been picked up.`;
    case "order.delivered": return `Your order ${title} was delivered. Please confirm you received it.`;
    case "order.expired": return `Your order ${title} expired before anyone accepted it.`;
    case "order.completed": return `${title} was confirmed as received.`;
    case "order.settled": return `You received ${payload.creditReward} credits for ${title}.`;
    default: return `Your order ${title} was updated.`;
  }
}

export const notificationLink = (notification: AppNotification) =>
  notification.orderId ? `/orders/${notification.orderId}` : undefined;
