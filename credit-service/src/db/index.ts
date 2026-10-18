import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 3000,
});
pool.on("error", (error) => {
  console.error(
    JSON.stringify({
      event: "credit_database_connection_error",
      reason: error.message,
    }),
  );
});
export const db = drizzle(pool);
export async function transaction<T>(
  run: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function lock(
  client: pg.PoolClient,
  namespace: string,
  key: string | number,
) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `${namespace}:${typeof key === "string" ? key.toLowerCase() : key}`,
  ]);
}
