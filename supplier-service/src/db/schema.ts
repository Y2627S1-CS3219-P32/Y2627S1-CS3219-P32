/**
 * AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
 * Scope: Implement the student-defined supplier database schema.
 * Author review: Prior scaffold reviewed; these schema changes await review.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  numeric,
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
