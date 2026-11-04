/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Drizzle PostgreSQL connection, mirroring notification-service. Author review: Pending.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to connect to PostgreSQL.");
}

export const pool = new Pool({ connectionString });
export const db = drizzle({ client: pool, schema });
