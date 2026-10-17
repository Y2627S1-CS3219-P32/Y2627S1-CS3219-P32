/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Storing notifications; redeliveries are ignored by the (source, event, user)
 * unique key. Author review: Pending.
 */
import { db } from "./db/index.js";
import { notifications } from "./db/schema.js";
import type { Notification } from "./rules.js";

export async function storeNotifications(list: Notification[]): Promise<void> {
  if (list.length === 0) return;
  await db.insert(notifications)
    .values(list.map((notification) => ({ ...notification, createdAt: new Date(notification.createdAt) })))
    .onConflictDoNothing();
}
