import { readFile } from "node:fs/promises";
import { pool, transaction } from "./index.js";
try {
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(3219001)");
    await client.query(
      await readFile(
        new URL("../../migrations/001_credit.sql", import.meta.url),
        "utf8",
      ),
    );
  });
} finally {
  await pool.end();
}
