/**
 * AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
 * Scope: Implement the student-defined supplier database schema.
 * Author review: Prior scaffold and these schema changes reviewed.
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
 * Scope: Local users table fed by user-events (columns chosen by the student, mirroring
 * order-service). Author review: Pending.
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
 * Scope: supplier_event_sequence and the supplier_events transactional outbox (delivery
 * approach chosen by the student). Author review: Pending.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const types = pgTable("types", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 256 }).notNull().unique(),
  ...timestamps(),
});

export const buildings = pgTable("buildings", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 256 }).notNull().unique(),
  ...timestamps(),
});

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 256 }).notNull(),
    supplierTypeId: uuid("supplier_type_id")
      .notNull()
      .references(() => types.id),
    locationDescription: varchar("location_description", { length: 256 }),
    buildingId: uuid("building_id").references(() => buildings.id),
    floor: varchar("floor", { length: 256 }),
    latitude: numeric("latitude", { precision: 9, scale: 6 }).notNull(),
    longitude: numeric("longitude", { precision: 9, scale: 6 }).notNull(),
    isActive: boolean("is_active").notNull(),
    imageUrl: text("image_url"),
    ...timestamps(),
  },
  (table) => [
    check("suppliers_latitude_check", sql`${table.latitude} between -90 and 90`),
    check("suppliers_longitude_check", sql`${table.longitude} between -180 and 180`),
  ],
);

export const operatingHours = pgTable(
  "operating_hours",
  {
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    day: integer("day").notNull(),
    openingHrs: time("opening_hrs").notNull(),
    closingHrs: time("closing_hrs").notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.supplierId, table.day, table.openingHrs] }),
    check("operating_hours_day_check", sql`${table.day} between 0 and 6`),
  ],
);

// Local copy of users from user-events, used to authorize callers without calling
// user-service. A deletion that arrives before the user's creation is stored as a
// row with only the id, version and deleted_at, so the older creation is skipped.
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

// Versions of supplier-events: one value per event, increasing across all suppliers.
export const supplierEventSequence = pgSequence("supplier_event_sequence");

// Transactional outbox for supplier-events. Each row is written in the same transaction
// as the change it describes and is unpublished while published_at is null. payload is
// the SupplierSnapshot for created/updated events and null for deletions.
export const supplierEvents = pgTable(
  "supplier_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    version: bigint("version", { mode: "number" }).notNull().unique()
      .default(sql`nextval('supplier_event_sequence')`),
    type: text("type").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    check("supplier_events_type_check", sql`${table.type} in ('supplier.created', 'supplier.updated', 'supplier.deleted')`),
    check("supplier_events_payload_check", sql`(${table.type} = 'supplier.deleted') = (${table.payload} is null)`),
    index("supplier_events_unpublished_idx").on(table.version).where(sql`${table.publishedAt} is null`),
  ],
);
