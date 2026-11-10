/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
 * Scope: Drizzle Kit configuration copied from order-service. Author review: Pending.
 */
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // Generating SQL is offline; database commands require DATABASE_URL.
  ...(url ? { dbCredentials: { url } } : {}),
});
