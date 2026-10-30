import { asc, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { pool, type Transaction } from "../db/index.js";
import { creditOutbox } from "../db/schema.js";
import type { OutcomeEvent } from "../common/types.js";

export async function insertOutbox(tx: Transaction, event: OutcomeEvent) {
  await tx.insert(creditOutbox).values({
    event_id: event.eventId,
    request_id: event.requestId,
    payload: event,
  });
}

export async function withPublisherLock(
  publish: (batch: {
    rows: (typeof creditOutbox.$inferSelect)[];
    markPublished: (eventId: string) => Promise<void>;
  }) => Promise<number>,
) {
  const connection = await pool.connect();
  const db = drizzle(connection);
  try {
    const {
      rows: [lock],
    } = await db.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_lock(982344) AS acquired`,
    );
    if (!lock?.acquired) return 0;
    try {
      const rows = await db
        .select()
        .from(creditOutbox)
        .where(isNull(creditOutbox.published_at))
        .orderBy(asc(creditOutbox.created_at), asc(creditOutbox.event_id))
        .limit(100);
      return await publish({
        rows,
        markPublished: async (eventId) => {
          await db
            .update(creditOutbox)
            .set({ published_at: sql`clock_timestamp()` })
            .where(eq(creditOutbox.event_id, eventId));
        },
      });
    } finally {
      await db.execute(sql`SELECT pg_advisory_unlock(982344)`);
    }
  } finally {
    connection.release();
  }
}
