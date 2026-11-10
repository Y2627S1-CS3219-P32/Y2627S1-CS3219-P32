/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
 * Scope: Order-ranking-service schema: a local copy of orders built from order-events
 * (with the text embedding of each order), the latest version of each supplier from
 * supplier-events (for pickup coordinates), and each courier's ranking preferences.
 * Author review: Pending.
 * Claude Code (Opus 5.5), 2026-11-01. Scope: embedding_input_version. Author review: Pending.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  vector,
} from "drizzle-orm/pg-core";

// text-embedding-3-small, and the hashing fallback, both produce 1536 numbers.
export const EMBEDDING_DIMENSIONS = 1536;

// Latest version of each supplier; older or repeated versions are ignored.
export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey(),
  version: bigint("version", { mode: "number" }).notNull(),
  deleted: boolean("deleted").notNull(),
  name: varchar("name", { length: 256 }),
  type: varchar("type", { length: 256 }),
  buildingName: varchar("building_name", { length: 256 }),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
});

// One row per order, replaced by every newer order event (by sequence).
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey(),
    // The sequence of the last order event applied, so older or repeated events are skipped.
    sequence: integer("sequence").notNull(),
    requesterId: integer("requester_id").notNull(),
    courierId: integer("courier_id"),
    supplierId: uuid("supplier_id").notNull(),
    title: varchar("title", { length: 100 }).notNull(),
    description: text("description").notNull(),
    deliveryLocation: text("delivery_location").notNull(),
    creditReward: integer("credit_reward").notNull(),
    state: text("state").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    // Embedding of title + description and the supplier's name and type. Null until the
    // background job has embedded the current text; a change to any of them clears it again.
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    // Raised whenever the embedded text changes, so an embedding of older text that was
    // still in flight is not stored.
    embeddingInputVersion: integer("embedding_input_version").notNull().default(0),
    embeddingAttempts: integer("embedding_attempts").notNull().default(0),
    embeddingError: text("embedding_error"),
    // After a failure, not retried before this time (backing off 1, 2, 4… minutes).
    embeddingRetryAt: timestamp("embedding_retry_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("orders_state_idx").on(table.state),
    index("orders_courier_accepted_idx").on(table.courierId, table.acceptedAt),
    index("orders_unembedded_idx").on(table.updatedAt).where(sql`${table.embedding} is null`),
  ],
);

// What a courier tells us they like. All fields are optional.
export const preferences = pgTable(
  "preferences",
  {
    userId: integer("user_id").primaryKey(),
    supplierTypes: text("supplier_types").array().notNull().default(sql`'{}'::text[]`),
    buildings: text("buildings").array().notNull().default(sql`'{}'::text[]`),
    minReward: integer("min_reward"),
    // Free text such as "bubble tea and snacks near UTown", embedded like an order.
    note: varchar("note", { length: 500 }),
    noteEmbedding: vector("note_embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    noteEmbeddingAttempts: integer("note_embedding_attempts").notNull().default(0),
    noteEmbeddingRetryAt: timestamp("note_embedding_retry_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("preferences_min_reward_check", sql`${table.minReward} is null or ${table.minReward} > 0`),
  ],
);
