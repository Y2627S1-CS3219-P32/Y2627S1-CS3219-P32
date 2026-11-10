/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
 * Scope: Background embedding of orders and preference notes. Events only store the
 * order; embedding happens here, outside the push handler, so an embedding outage
 * never holds up order events. Failures are retried with back-off, up to
 * EMBEDDING_MAX_ATTEMPTS times.
 * Author review: Pending.
 * Claude Code (Opus 5.5), 2026-11-01. Scope: An order embedding is stored only if the
 * order's text and supplier have not changed since it was read. Author review: Pending.
 */
import { and, asc, eq, isNotNull, isNull, lt, or, sql, type AnyColumn } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { orders, preferences, suppliers } from "../db/schema.js";
import { embed, orderText } from "./embeddings.js";

// Due now: never failed, or its back-off has passed.
const due = (retryAt: AnyColumn) => or(isNull(retryAt), sql`${retryAt} <= now()`);
// 1, 2, 4, 8… minutes after the 1st, 2nd, 3rd, 4th… failure.
const backOff = (attempts: AnyColumn) => sql`now() + make_interval(mins => power(2, ${attempts})::int)`;

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

async function embedOrders(): Promise<number> {
  const pending = await db
    .select({
      id: orders.id,
      title: orders.title,
      description: orders.description,
      inputVersion: orders.embeddingInputVersion,
      supplierName: suppliers.name,
      supplierType: suppliers.type,
    })
    .from(orders)
    .leftJoin(suppliers, eq(orders.supplierId, suppliers.id))
    .where(and(isNull(orders.embedding), lt(orders.embeddingAttempts, config.embedding.maxAttempts), due(orders.embeddingRetryAt)))
    .orderBy(asc(orders.updatedAt))
    .limit(config.embedding.batchSize);
  if (pending.length === 0) return 0;

  const texts = pending.map((order) => orderText(order, { name: order.supplierName, type: order.supplierType }));
  let vectors: number[][];
  try {
    vectors = await embed(texts);
  } catch (error) {
    console.error(`[order-ranking-service] Embedding ${pending.length} orders failed: ${message(error)}`);
    for (const order of pending) {
      await db.update(orders)
        .set({ embeddingAttempts: sql`${orders.embeddingAttempts} + 1`, embeddingError: message(error), embeddingRetryAt: backOff(orders.embeddingAttempts) })
        .where(eq(orders.id, order.id));
    }
    return 0;
  }

  let stored = 0;
  for (const [index, order] of pending.entries()) {
    // Skipped if the order was edited, or its supplier changed, while it was being embedded;
    // the next run embeds the new text.
    const updated = await db.update(orders)
      .set({ embedding: vectors[index]!, embeddingError: null })
      .where(and(eq(orders.id, order.id), eq(orders.embeddingInputVersion, order.inputVersion)))
      .returning({ id: orders.id });
    stored += updated.length;
  }
  return stored;
}

async function embedNotes(): Promise<number> {
  const pending = await db
    .select({ userId: preferences.userId, note: preferences.note })
    .from(preferences)
    .where(and(
      isNotNull(preferences.note),
      isNull(preferences.noteEmbedding),
      lt(preferences.noteEmbeddingAttempts, config.embedding.maxAttempts),
      due(preferences.noteEmbeddingRetryAt),
    ))
    .limit(config.embedding.batchSize);
  if (pending.length === 0) return 0;

  let vectors: number[][];
  try {
    vectors = await embed(pending.map((row) => row.note!));
  } catch (error) {
    console.error(`[order-ranking-service] Embedding ${pending.length} preference notes failed: ${message(error)}`);
    for (const row of pending) {
      await db.update(preferences)
        .set({ noteEmbeddingAttempts: sql`${preferences.noteEmbeddingAttempts} + 1`, noteEmbeddingRetryAt: backOff(preferences.noteEmbeddingAttempts) })
        .where(eq(preferences.userId, row.userId));
    }
    return 0;
  }

  let stored = 0;
  for (const [index, row] of pending.entries()) {
    const updated = await db.update(preferences)
      .set({ noteEmbedding: vectors[index]! })
      .where(and(eq(preferences.userId, row.userId), eq(preferences.note, row.note!)))
      .returning({ userId: preferences.userId });
    stored += updated.length;
  }
  return stored;
}

export async function processPendingEmbeddings(): Promise<{ orders: number; notes: number }> {
  return { orders: await embedOrders(), notes: await embedNotes() };
}

// One run at a time per instance; a request during a run schedules one more run.
let running: Promise<void> | undefined;
let again = false;

export function requestEmbedding(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        const done = await processPendingEmbeddings();
        // A full batch may mean more are waiting.
        if (done.orders >= config.embedding.batchSize || done.notes >= config.embedding.batchSize) again = true;
      } while (again);
    } catch (error) {
      console.error("[order-ranking-service] Embedding run failed", error);
    } finally {
      running = undefined;
    }
  })();
  return running;
}
