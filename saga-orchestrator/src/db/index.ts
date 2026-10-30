/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
 * Scope: Drizzle PostgreSQL connection, mirroring order-service. Author review: Pending.
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

export type Database = typeof db;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
