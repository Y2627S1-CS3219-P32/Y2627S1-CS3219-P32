import { sendToUser } from "./connections.js";
import { notificationsForCreditEvent } from "./rules.js";

export function routeCreditEvent(event: unknown): void {
  for (const notification of notificationsForCreditEvent(event)) {
    sendToUser(notification.userId, { type: "notification", notification });
  }
}
