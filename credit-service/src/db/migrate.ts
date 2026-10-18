import { fileURLToPath, pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { pool } from "./index.js";

export async function migrateDatabase() {
  const client = await pool.connect();
  const db = drizzle(client);
  try {
    await db.execute(sql`SELECT pg_advisory_lock(3219001)`);
    try {
      await migrate(db, {
        migrationsFolder: fileURLToPath(
          new URL("../../migrations", import.meta.url),
        ),
      });
    } finally {
      await db.execute(sql`SELECT pg_advisory_unlock(3219001)`);
    }
  } finally {
    client.release();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await migrateDatabase();
  } finally {
    await pool.end();
  }
}
