/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: PostgreSQL connection and development-user seeding
    Author review: Done
**/
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";

import { hashPassword } from './auth';
import { usersTable } from './db/schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to connect to PostgreSQL");
}

export const pool = new Pool({ connectionString });
export const db = drizzle({ client: pool });

export async function initializeDatabase(): Promise<void> {
  const [existingUser] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  if (existingUser) return;

  await db.insert(usersTable).values([
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
  ]);
}