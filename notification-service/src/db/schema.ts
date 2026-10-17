/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Implement the student-defined notifications table (one row per user per
 * event, keyed by the event's source and id). Author review: Pending.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const SOURCES = ["order", "credit"] as const;
export type Source = (typeof SOURCES)[number];

export const notifications = pgTable(
  "notifications",
  {
    // Derived from (source, event_id, user_id), so the live push and the stored row agree.
    id: uuid("id").primaryKey(),
    userId: integer("user_id").notNull(),
    source: text("source").$type<Source>().notNull(),
    eventId: uuid("event_id").notNull(),
    orderId: uuid("order_id"),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    // When the event happened, not when it was stored.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    unique("notifications_source_event_user_unique").on(table.source, table.eventId, table.userId),
    check("notifications_source_check", sql`${table.source} in ('order', 'credit')`),
    index("notifications_user_created_idx").on(table.userId, table.createdAt, table.id),
    index("notifications_unread_idx").on(table.userId).where(sql`${table.readAt} is null`),
  ],
);
