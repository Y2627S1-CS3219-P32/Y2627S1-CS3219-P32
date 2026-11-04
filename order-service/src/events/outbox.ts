/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Transactional outbox relay that publishes unpublished order_events rows
 * to the order-events topic in per-order sequence. Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-17: type and orderId attributes for subscription
 * filters. Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-18: callers wait for the publish before responding, since
 * Cloud Run throttles CPU after a response. Author review: Pending.
 */
import { asc, inArray, isNull, sql } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { orderEvents } from "../db/schema.js";
import { publish } from "./pubsub.js";

const BATCH = 100;

// Publishes at least once: a crash after publishing but before marking the row
// re-publishes it, so consumers dedupe by eventId.
export async function publishPendingEvents(): Promise<number> {
  return db.transaction(async (tx) => {
    // One relay at a time keeps each order's events in sequence.
    const { rows } = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(3219, 3) as locked`);
    if (!rows[0]?.locked) return 0;

    const pending = await tx.select().from(orderEvents)
      .where(isNull(orderEvents.publishedAt))
      .orderBy(asc(orderEvents.createdAt), asc(orderEvents.sequence))
      .limit(BATCH);

    // Group each order's events in sequence (timestamps alone can tie or interleave).
    const firstSeen = new Map<string, number>();
    pending.forEach((event, index) => {
      if (!firstSeen.has(event.orderId)) firstSeen.set(event.orderId, index);
    });
    pending.sort((a, b) => firstSeen.get(a.orderId)! - firstSeen.get(b.orderId)! || a.sequence - b.sequence);

    const published: string[] = [];
    const blocked = new Set<string>();
    for (const event of pending) {
      // After a failure, later events of the same order must wait for the next run.
      if (blocked.has(event.orderId)) continue;
      try {
        await publish(config.pubsub.orderEventsTopic, {
          eventId: event.id,
          type: event.type,
          orderId: event.orderId,
          sequence: event.sequence,
          state: event.state,
          actorId: event.actorId,
          commandId: event.commandId,
          occurredAt: event.createdAt.toISOString(),
          order: event.payload,
        }, event.orderId, { type: event.type, orderId: event.orderId });
        published.push(event.id);
      } catch (error) {
        console.error(`[order-service] Failed to publish event ${event.id}`, error);
        blocked.add(event.orderId);
      }
    }

    if (published.length > 0) {
      await tx.update(orderEvents).set({ publishedAt: new Date() }).where(inArray(orderEvents.id, published));
    }
    return published.length;
  });
}

let running: Promise<void> | undefined;
let rerun = false;

// Publishes what was just committed. Callers await it before responding: Cloud Run throttles
// CPU once a response is sent, which would stall a publish left running in the background.
// A commit during a run triggers one more run, and its caller waits for that run too. Publish
// failures are logged, not thrown: the rows stay unpublished and POST /internal/outbox/publish
// (Cloud Scheduler) retries them.
export function requestOutboxPublish(): Promise<void> {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    do {
      rerun = false;
      await publishPendingEvents();
    } while (rerun);
  })()
    .catch((error: unknown) => console.error("[order-service] Outbox relay failed", error))
    .finally(() => {
      running = undefined;
    });
  return running;
}

// Lets tests wait for a relay started by a request.
export function outboxIdle(): Promise<void> {
  return running ?? Promise.resolve();
}
