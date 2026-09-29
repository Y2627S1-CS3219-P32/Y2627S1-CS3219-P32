/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Drizzle repository for user CRUD and credential lookup
    Author review: Pending
**/
import { eq } from "drizzle-orm";

import { db } from "../db";
import { usersTable, type PublicUser, type User } from "../db/schema";

const publicUserColumns = {
  id: usersTable.id,
  name: usersTable.name,
  email: usersTable.email,
  role: usersTable.role,
};

export function findAllUsers(): PublicUser[] {
  return db.select(publicUserColumns).from(usersTable).all();
}

export function findPublicUserById(id: number): PublicUser | undefined {
  return db.select(publicUserColumns).from(usersTable).where(eq(usersTable.id, id)).get();
}

export function findUserByEmail(email: string): User | undefined {
  return db.select().from(usersTable).where(eq(usersTable.email, email)).get();
}

export function countAdministrators(): number {
  return db.select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"))
    .all()
    .length;
}

export function insertUser(values: {
  name: string;
  email: string;
  role: "student" | "admin";
  passwordHash: string;
}): PublicUser {
  const result = db.insert(usersTable).values(values).run();
  const user = findPublicUserById(Number(result.lastInsertRowid));
  if (!user) throw new Error("Inserted user could not be found");
  return user;
}

export function updateUser(
  id: number,
  values: Partial<Pick<User, "name" | "email" | "role" | "passwordHash">>,
): PublicUser | undefined {
  db.update(usersTable).set(values).where(eq(usersTable.id, id)).run();
  return findPublicUserById(id);
}

export function deleteUser(id: number): boolean {
  return db.delete(usersTable).where(eq(usersTable.id, id)).run().changes > 0;
}
