/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Database initialization and development-user password seeding
    Author review: Pending
**/
import { drizzle } from 'drizzle-orm/node-sqlite';
import { eq } from 'drizzle-orm';

import { hashPassword } from './auth';
import { usersTable } from './db/schema';

export const db = drizzle(process.env.DATABASE_PATH ?? "./users.sqlite");

function seedUserTableIfEmpty(): void {
  const currentUsers = db.select({ id: usersTable.id }).from(usersTable).all();

  if (currentUsers.length === 0) {
    db.insert(usersTable).values([
      {
        name: "admin",
        email: "admin@foc.com",
        role: "admin",
        passwordHash: hashPassword("Password123!"),
      },
      {
        name: "John Doe",
        email: "john@u.nus.edu",
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