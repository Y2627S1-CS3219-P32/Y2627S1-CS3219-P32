/**
 * AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
 * Scope: Drizzle Kit configuration. Author review: pending.
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
