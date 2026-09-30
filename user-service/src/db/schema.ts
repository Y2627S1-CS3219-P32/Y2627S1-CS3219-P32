/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: PostgreSQL user schema and case-insensitive display-name uniqueness
    Author review: Done
**/
import { sql } from "drizzle-orm";
import { pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";

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

export type User = typeof usersTable.$inferSelect;
export type PublicUser = Pick<User, "id" | "name" | "displayName" | "email" | "role">;