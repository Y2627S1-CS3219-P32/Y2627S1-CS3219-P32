import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';
let connection: Pool | undefined;
const sessions = new AsyncLocalStorage<PoolClient>();
export function pool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Missing DATABASE_URL');
  return (connection ??= new Pool({
    connectionString,
    max: 60,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  }));
}
export function sql(text: string, values: unknown[] = []) {
  return (sessions.getStore() ?? pool()).query(text, values);
}
export async function rows<T>(
  schema: z.ZodType<T>,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  return z.array(schema).parse((await sql(text, values)).rows);
}
export async function transaction<T>(work: () => Promise<T>): Promise<T> {
  const existing = sessions.getStore(),
    client = existing ?? (await pool().connect());
  try {
    return await sessions.run(client, async () => {
      await client.query('BEGIN');
      try {
        const result = await work();
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  } finally {
    if (!existing) client.release();
  }
}
export async function closeDatabase() {
  await connection?.end();
  connection = undefined;
}
