/**
 * AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
 * Scope: Read-only Drizzle connection check. Author review: Done.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "./index.js";

try {
  await db.execute(sql`select 1`);
  console.log("Drizzle connected to PostgreSQL successfully.");
} finally {
  await pool.end();
}
