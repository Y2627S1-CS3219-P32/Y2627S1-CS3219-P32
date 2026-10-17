/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Sync-service tables: one document per group order, its members, and the
 * append-only log of Yjs updates that make up the document. Author review: Pending.
 */
import { sql } from "drizzle-orm";
import { bigserial, check, customType, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

export const DOCUMENT_STATUSES = ["open", "placed", "cancelled"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const documents = pgTable(
  "documents",
  {
    orderId: uuid("order_id").primaryKey(),
    requesterId: integer("requester_id").notNull(),
    status: text("status").$type<DocumentStatus>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (table) => [check("documents_status_check", sql`${table.status} in ('open', 'placed', 'cancelled')`)],
);

// Local copy of group members, from order.member_joined events.
export const documentMembers = pgTable(
  "document_members",
  {
    orderId: uuid("order_id").notNull().references(() => documents.orderId),
    userId: integer("user_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.orderId, table.userId] })],
);

// Merging every update in any order gives the same document; loading merges them.
export const documentUpdates = pgTable(
  "document_updates",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orderId: uuid("order_id").notNull().references(() => documents.orderId),
    update: bytea("update").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("document_updates_order_idx").on(table.orderId, table.id)],
);
