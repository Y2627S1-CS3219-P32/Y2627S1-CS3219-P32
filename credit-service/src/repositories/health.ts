import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

export async function checkDatabase() {
  await db.execute(sql`SELECT 1`);
}
