/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Async PostgreSQL user repository including self-service account updates
    Author review: Done
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Return verification status publicly and code to administrator listings
    Author review: Pending
**/
import { eq, sql } from "drizzle-orm";

import { db, pool } from "../db";
import {
  passwordResetTokensTable,
  usersTable,
  type AdminUser,
  type PublicUser,
  type User,
} from "../db/schema";

const publicUserColumns = {
  id: usersTable.id,
  name: usersTable.name,
  displayName: usersTable.displayName,
  email: usersTable.email,
  role: usersTable.role,
  verificationStatus: usersTable.verificationStatus,
};

const adminUserColumns = {
  ...publicUserColumns,
  verificationCode: usersTable.verificationCode,
};

export async function findAllUsers(): Promise<AdminUser[]> {
  return db.select(adminUserColumns).from(usersTable);
}

export async function findPublicUserById(id: number): Promise<PublicUser | undefined> {
  const [user] = await db.select(publicUserColumns).from(usersTable)
    .where(eq(usersTable.id, id)).limit(1);
  return user;
}

export async function findAdminUserById(id: number): Promise<AdminUser | undefined> {
  const [user] = await db.select(adminUserColumns).from(usersTable)
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

export async function invalidatePasswordResetToken(userId: number): Promise<void> {
  await db.delete(passwordResetTokensTable)
    .where(eq(passwordResetTokensTable.userId, userId));
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

export async function findProjectedUserEventVersion(): Promise<number> {
  const { rows } = await pool.query<{ version: string }>(
    "SELECT COALESCE(MAX(version), 0)::text AS version FROM user_event_states",
  );
  const version = Number(rows[0]?.version);
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new Error("Could not read the projected user event version");
  }
  return version;
}
