/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: User display-name and password-hash columns and public-user type
    Author review: Done
**/
import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const usersTable = sqliteTable("users", {
  id: int().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  displayName: text("display_name").notNull().default(""),
  email: text().notNull().unique(),
  role: text({ enum: ["student", "admin"] }).notNull(),
  passwordHash: text().notNull().default(""),
});

export type User = typeof usersTable.$inferSelect;
export type PublicUser = Pick<User, "id" | "name" | "displayName" | "email" | "role">;