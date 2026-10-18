/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
 * Scope: Outbox relay publishing the orchestrator's commands in order per order id, as in
 * order-service (at least once; credit and order-service deduplicate). Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-18: callers wait for the publish before responding, since
 * Cloud Run throttles CPU after a response. Author review: Pending.
 */
import { asc, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { outbox } from "./db/schema.js";
import { publish } from "./pubsub.js";

const BATCH = 100;

export async function publishPending(): Promise<number> {
  return db.transaction(async (tx) => {
    // One relay at a time keeps each order's commands in sequence.
    const { rows } = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(3219, 4) as locked`);
    if (!rows[0]?.locked) return 0;

    const pending = await tx.select().from(outbox).where(isNull(outbox.publishedAt))
      .orderBy(asc(outbox.createdAt), asc(outbox.id)).limit(BATCH);
    const published: string[] = [];
    const blocked = new Set<string>();
    for (const row of pending) {
      // After a failure, later commands for the same order wait for the next run.
      if (blocked.has(row.orderingKey)) continue;
      try {
        await publish(row.topic, row.payload, row.orderingKey, { type: row.type });
        published.push(row.id);
      } catch (error) {
        console.error(`[saga-orchestrator] Failed to publish ${row.type} for ${row.orderingKey}`, error);
        blocked.add(row.orderingKey);
      }
    }
    if (published.length > 0) await tx.update(outbox).set({ publishedAt: new Date() }).where(inArray(outbox.id, published));
    return published.length;
  });
}

let running: Promise<void> | undefined;
let rerun = false;

// Publishes what was just committed. Callers await it before responding: Cloud Run throttles
// CPU once a response is sent. Failures are logged; POST /internal/outbox/publish (Cloud
// Scheduler) retries the rows still unpublished.
export function requestPublish(): Promise<void> {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    do {
      rerun = false;
      await publishPending();
    } while (rerun);
  })()
    .catch((error: unknown) => console.error("[saga-orchestrator] Outbox relay failed", error))
    .finally(() => {
      running = undefined;
    });
  return running;
}

export function outboxIdle(): Promise<void> {
  return running ?? Promise.resolve();
}
