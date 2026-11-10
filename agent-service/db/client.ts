import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout } from 'node:timers/promises';
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
export async function transaction<T>(
  work: () => Promise<T>,
  isolation: 'read committed' | 'repeatable read' = 'read committed',
): Promise<T> {
  const existing = sessions.getStore(),
    client = existing ?? (await pool().connect());
  try {
    return await sessions.run(client, async () => {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
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
export async function locked<T>(
  key: string,
  signal: AbortSignal,
  work: (owned: AbortSignal) => Promise<T>,
): Promise<T> {
  const client = await pool().connect(),
    controller = new AbortController();
  const owned = AbortSignal.any([signal, controller.signal]);
  const failed = () => controller.abort(new Error('Database ownership lost'));
  client.on('error', failed);
  let acquired = false;
  try {
    while (!acquired) {
      owned.throwIfAborted();
      const result = await client.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',
        [key],
      );
      acquired = z.object({ acquired: z.boolean() }).parse(result.rows[0]).acquired;
      if (!acquired) await setTimeout(100, undefined, { signal: owned });
    }
    return await sessions.run(client, () => work(owned));
  } finally {
    if (acquired)
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]).catch(failed);
    client.removeListener('error', failed);
    client.release(controller.signal.aborted);
  }
}
export async function closeDatabase() {
  await connection?.end();
  connection = undefined;
}
