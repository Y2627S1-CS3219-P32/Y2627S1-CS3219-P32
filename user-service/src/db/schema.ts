import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const usersTable = sqliteTable("users", {
  id: int().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  email: text().notNull().unique(),
  role: text({ enum: ["student", "admin"] }).notNull(),
});

export type User = typeof usersTable.$inferSelect;