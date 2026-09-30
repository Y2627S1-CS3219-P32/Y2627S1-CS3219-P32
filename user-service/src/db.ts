/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-30
    Scope: PostgreSQL connection without automatic user seeding
    Author review: Done
**/
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to connect to PostgreSQL");
}

export const pool = new Pool({ connectionString });
export const db = drizzle({ client: pool });

export async function initializeDatabase(): Promise<void> {
  await pool.query("SELECT 1");
}