/**
 * AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
 * Scope: Read-only Drizzle connection check. Author review: Done.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "./index.js";
// Claude Code (Opus 5.5), 2026-11-04: logs through the shared pino logger. Author review: Pending.
import { logger } from "../shared/logger.js";

try {
  await db.execute(sql`select 1`);
  logger.info("Drizzle connected to PostgreSQL successfully.");
} finally {
  await pool.end();
}
