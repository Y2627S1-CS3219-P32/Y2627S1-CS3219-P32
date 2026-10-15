/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Async PostgreSQL user repository including self-service account updates
    Author review: Done
**/
import { eq, sql } from "drizzle-orm";

import { db, pool } from "../db";
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

export async function reserveUserId(): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT nextval(pg_get_serial_sequence('users', 'id')) AS id",
  );
  const id = Number(rows[0]?.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Could not reserve a valid user id");
  }
  return id;
}

export async function reserveUserEventVersion(): Promise<number> {
  const { rows } = await pool.query<{ version: string }>(
    "SELECT nextval('user_event_sequence') AS version",
  );
  const version = Number(rows[0]?.version);
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new Error("Could not reserve a valid user event version");
  }
  return version;
}
