/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Async PostgreSQL user repository including self-service account updates
    Author review: Done
**/
import { eq, sql } from "drizzle-orm";

import { db } from "../db";
import { usersTable, type PublicUser, type User } from "../db/schema";

const publicUserColumns = {
  id: usersTable.id,
  name: usersTable.name,
  displayName: usersTable.displayName,
  email: usersTable.email,
  role: usersTable.role,
};

export async function findAllUsers(): Promise<PublicUser[]> {
  return db.select(publicUserColumns).from(usersTable);
}

export async function findPublicUserById(id: number): Promise<PublicUser | undefined> {
  const [user] = await db.select(publicUserColumns).from(usersTable)
    .where(eq(usersTable.id, id)).limit(1);
  return user;
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  return user;
}

export async function findUserById(id: number): Promise<User | undefined> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  return user;
}

export async function findUserByDisplayName(displayName: string): Promise<User | undefined> {
  const [user] = await db.select().from(usersTable)
    .where(sql`lower(${usersTable.displayName}) = ${displayName.toLowerCase()}`)
    .limit(1);
  return user;
}

export async function countAdministrators(): Promise<number> {
  const admins = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"))
  return admins.length;
}

export async function insertUser(values: {
  name: string;
  displayName?: string;
  email: string;
  role: "student" | "admin";
  passwordHash: string;
}): Promise<PublicUser> {
  const [user] = await db.insert(usersTable).values(values).returning(publicUserColumns);
  if (!user) throw new Error("Inserted user could not be found");
  return user;
}

export async function updateUser(
  id: number,
  values: Partial<Pick<User, "name" | "displayName" | "email" | "role" | "passwordHash">>,
): Promise<PublicUser | undefined> {
  const [user] = await db.update(usersTable).set(values)
    .where(eq(usersTable.id, id)).returning(publicUserColumns);
  return user;
}

export async function deleteUser(id: number): Promise<boolean> {
  const deleted = await db.delete(usersTable).where(eq(usersTable.id, id)).returning({ id: usersTable.id });
  return deleted.length > 0;
}
