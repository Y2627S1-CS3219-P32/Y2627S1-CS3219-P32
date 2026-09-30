/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Database display-name migration and development-user seeding
    Author review: Done
**/
import { drizzle } from 'drizzle-orm/node-sqlite';
import { eq } from 'drizzle-orm';
import { DatabaseSync } from "node:sqlite";

import { hashPassword } from './auth';
import { usersTable } from './db/schema';

const databasePath = process.env.DATABASE_PATH ?? "./users.sqlite";

function migrateDisplayNames(): void {
  const sqlite = new DatabaseSync(databasePath);
  try {
    const columns = sqlite.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "display_name")) {
      sqlite.exec("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
    }

    sqlite.exec("BEGIN IMMEDIATE");
    try {
      const users = sqlite.prepare(
        "SELECT id, name, display_name FROM users ORDER BY id",
      ).all() as Array<{ id: number; name: string; display_name: string }>;
      const usedDisplayNames = new Set<string>();
      const updateDisplayName = sqlite.prepare(
        "UPDATE users SET display_name = ? WHERE id = ?",
      );
      for (const user of users) {
        const existingDisplayName = user.display_name.replace(/ +/g, "-");
        let displayName = existingDisplayName;
        if (!isValidDisplayName(displayName) || usedDisplayNames.has(displayName.toLowerCase())) {
          const nameCandidate = user.name.trim().replace(/ +/g, "-");
          displayName = isValidDisplayName(nameCandidate)
            && !usedDisplayNames.has(nameCandidate.toLowerCase())
            ? nameCandidate
            : fallbackDisplayName(user.id, usedDisplayNames);
        }
        if (displayName !== user.display_name) {
          updateDisplayName.run(displayName, user.id);
        }
        usedDisplayNames.add(displayName.toLowerCase());
      }
      sqlite.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS users_display_name_unique " +
        "ON users (lower(display_name)) WHERE display_name <> ''",
      );
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  } finally {
    sqlite.close();
  }
}

function isValidDisplayName(displayName: string): boolean {
  return displayName.length >= 2
    && displayName.length <= 50
    && /^[A-Za-z](?:[A-Za-z-]*[A-Za-z])$/.test(displayName);
}

function fallbackDisplayName(userId: number, usedDisplayNames: Set<string>): string {
  let suffix = userId;
  while (true) {
    let letters = "";
    let value = suffix;
    while (value > 0) {
      value -= 1;
      letters = String.fromCharCode(65 + value % 26) + letters;
      value = Math.floor(value / 26);
    }
    const candidate = `User${letters}`;
    if (!usedDisplayNames.has(candidate.toLowerCase())) return candidate;
    suffix += 1;
  }
}

migrateDisplayNames();

export const db = drizzle(databasePath);

function seedUserTableIfEmpty(): void {
  const currentUsers = db.select({ id: usersTable.id }).from(usersTable).all();

  if (currentUsers.length === 0) {
    db.insert(usersTable).values([
      {
        name: "admin",
        displayName: "Admin",
        email: "admin@foc.com",
        role: "admin",
        passwordHash: hashPassword("Password123!"),
      },
      {
        name: "John Doe",
        displayName: "JohnDoe",
        email: "john@foc.com",
        role: "student",
        passwordHash: hashPassword("Password123!"),
      },
    ]).run();
    return;
  }

  const usersWithoutPassword = db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.passwordHash, ""))
    .all();
  for (const user of usersWithoutPassword) {
    db.update(usersTable)
      .set({ passwordHash: hashPassword("Password123!") })
      .where(eq(usersTable.id, user.id))
      .run();
  }
}

seedUserTableIfEmpty();