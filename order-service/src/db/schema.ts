/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Implement the student-defined order-service schema: local user and
 * append-only supplier copies, orders, and the order event log / outbox.
 * Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-17: student-requested title column. Author review: Pending.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const ORDER_STATES = [
  "PENDING",
  "OPEN",
  "REJECTED",
  "ABORTED",
  "ACCEPTED",
  "CANCELLED",
  "EXPIRED",
  "PICKED_UP",
  "DELIVERED",
  "COMPLETE",
  "SETTLED",
] as const;
export type OrderState = (typeof ORDER_STATES)[number];

const stateList = sql.raw(ORDER_STATES.map((state) => `'${state}'`).join(", "));

export interface OperatingPeriod {
  day: number;
  openingHrs: string;
  closingHrs: string;
}

// Local copy of users from user-events. Deleted users are kept (soft delete) so
// orders can still reference them. A deletion that arrives before the user's
// creation is stored as a row with only the id, version and deleted_at.
export const users = pgTable(
  "users",
  {
    id: integer("id").primaryKey(),
    displayName: text("display_name"),
    role: text("role"),
    version: bigint("version", { mode: "number" }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "users_details_check",
      sql`${table.deletedAt} is not null or (${table.displayName} is not null and ${table.role} is not null)`,
    ),
  ],
);

// Append-only copy of suppliers from supplier-events: one row per event version.
// The latest version is the current supplier; a deleted row is a tombstone.
export const supplierVersions = pgTable(
  "supplier_versions",
  {
    supplierId: uuid("supplier_id").notNull(),
    version: bigint("version", { mode: "number" }).notNull(),
    deleted: boolean("deleted").notNull(),
    name: varchar("name", { length: 256 }),
    type: varchar("type", { length: 256 }),
    buildingName: varchar("building_name", { length: 256 }),
    floor: varchar("floor", { length: 256 }),
    locationDescription: varchar("location_description", { length: 256 }),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    isActive: boolean("is_active"),
    operatingHours: jsonb("operating_hours").$type<OperatingPeriod[]>(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.supplierId, table.version] }),
    check(
      "supplier_versions_details_check",
      sql`${table.deleted} or (${table.name} is not null and ${table.type} is not null and ${table.latitude} is not null and ${table.longitude} is not null and ${table.isActive} is not null and ${table.operatingHours} is not null)`,
    ),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requesterId: integer("requester_id").notNull().references(() => users.id),
    courierId: integer("courier_id").references(() => users.id),
    supplierId: uuid("supplier_id").notNull(),
    supplierVersion: bigint("supplier_version", { mode: "number" }).notNull(),
    title: varchar("title", { length: 100 }).notNull(),
    description: text("description").notNull(),
    deliveryLocation: text("delivery_location").notNull(),
    creditReward: integer("credit_reward").notNull(),
    // Cached from the latest order_events row; always updated in the same transaction.
    currentState: text("current_state").$type<OrderState>().notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      name: "orders_supplier_version_fk",
      columns: [table.supplierId, table.supplierVersion],
      foreignColumns: [supplierVersions.supplierId, supplierVersions.version],
    }),
    check("orders_credit_reward_check", sql`${table.creditReward} > 0`),
    check("orders_current_state_check", sql`${table.currentState} in (${stateList})`),
    index("orders_state_reward_idx").on(table.currentState, table.creditReward, table.id),
    index("orders_state_created_idx").on(table.currentState, table.createdAt, table.id),
    index("orders_requester_created_idx").on(table.requesterId, table.createdAt, table.id),
    index("orders_supplier_idx").on(table.supplierId),
    index("orders_open_expiry_idx").on(table.expiresAt).where(sql`${table.currentState} = 'OPEN'`),
  ],
);

// Append-only order log: the source of truth for state changes, the transactional
// outbox (unpublished while published_at is null), and the history shown to users.
export const orderEvents = pgTable(
  "order_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    state: text("state").$type<OrderState>().notNull(),
    // Null for system changes (saga commands, expiry).
    actorId: integer("actor_id").references(() => users.id),
    // The saga command that caused this event, so a redelivered command cannot append twice.
    commandId: uuid("command_id").unique(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    unique("order_events_order_sequence_unique").on(table.orderId, table.sequence),
    check("order_events_state_check", sql`${table.state} in (${stateList})`),
    index("order_events_unpublished_idx").on(table.createdAt).where(sql`${table.publishedAt} is null`),
  ],
);
