/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Password-hash seeding and public/authenticated user queries
    Author review: Pending
**/
import { drizzle } from 'drizzle-orm/node-sqlite';
import { eq } from 'drizzle-orm';

import { hashPassword } from './auth';
import { usersTable, PublicUser, User } from './db/schema';

export const db = drizzle(process.env.DATABASE_PATH ?? "./users.sqlite");

const publicUserColumns = {
  id: usersTable.id,
  name: usersTable.name,
  email: usersTable.email,
  role: usersTable.role,
};

export function getAllUsers(): PublicUser[] {
  return db.select(publicUserColumns).from(usersTable).all();
}

export function getUserByEmail(email: string): User | undefined {
  return db.select().from(usersTable).where(eq(usersTable.email, email)).get();
}

export function getPublicUserById(id: number): PublicUser | undefined {
  return db.select(publicUserColumns).from(usersTable).where(eq(usersTable.id, id)).get();
}

function seedUserTableIfEmpty(): void {
  const currentUsers = getAllUsers();

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