import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from './schema.js';
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 3000,
});
pool.on('error', (error) => {
  console.error(
    JSON.stringify({
      event: 'credit_database_connection_error',
      reason: error.message,
    }),
  );
});
export const db = drizzle({ client: pool, schema });
export type Database = typeof db;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export async function lock(
  tx: Transaction,
  namespace: string,
  key: string | number,
) {
  const name = `${namespace}:${typeof key === 'string' ? key.toLowerCase() : key}`;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${name},0))`,
  );
}
