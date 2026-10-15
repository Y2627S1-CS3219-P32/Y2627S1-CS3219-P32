/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: PostgreSQL user schema and case-insensitive display-name uniqueness
    Author review: Done
**/
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  integer,
  pgSequence,
  pgTable,
  serial,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: serial().primaryKey(),
  name: text().notNull(),
  displayName: text("display_name").notNull().default(""),
  email: text().notNull(),
  role: text("role", { enum: ["student", "admin"] }).notNull(),
  passwordHash: text().notNull().default(""),
}, (table) => [
  uniqueIndex("users_email_unique").on(table.email),
  uniqueIndex("users_display_name_unique").on(sql`lower(${table.displayName})`)
    .where(sql`${table.displayName} <> ''`),
]);

export const userBootstrapReservationsTable = pgTable("user_bootstrap_reservations", {
  id: integer().primaryKey(),
  userId: integer("user_id").notNull(),
});

export const userEventSequence = pgSequence("user_event_sequence");
export const userEventStatesTable = pgTable("user_event_states", {
  userId: integer("user_id").primaryKey(),
  version: bigint({ mode: "number" }).notNull(),
  deleted: boolean().notNull(),
});

export type User = typeof usersTable.$inferSelect;
export type PublicUser = Pick<User, "id" | "name" | "displayName" | "email" | "role">;