import { createServer } from "node:http";
import { PubSub } from "@google-cloud/pubsub";
import { pathToFileURL } from "node:url";
import { config } from "../config.js";
import { pool } from "../db/index.js";
import { drizzle } from "drizzle-orm/node-postgres";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { creditOutbox } from "../db/schema.js";
export interface OrderedTopic {
  publishMessage(message: {
    data: Buffer;
    attributes: Record<string, string>;
    orderingKey: string;
  }): Promise<string>;
  resumePublishing(key: string): void;
}
export async function publishBatch(
  topic: OrderedTopic,
  afterPublish?: () => Promise<void>,
) {
  const client = await pool.connect();
  const db = drizzle(client);
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
      let count = 0;
      for (const row of rows) {
        const payload = row.payload;
        const key = payload.orderId ?? String(payload.data.requesterId);
        const attributes: Record<string, string> = { type: payload.type };
        if (payload.orderId) attributes.orderId = payload.orderId;
        try {
          await topic.publishMessage({
            data: Buffer.from(JSON.stringify(payload)),
            attributes,
            orderingKey: key,
          });
          await afterPublish?.();
          await db
            .update(creditOutbox)
            .set({ published_at: sql`clock_timestamp()` })
            .where(eq(creditOutbox.event_id, row.event_id));
          count++;
        } catch (error) {
          topic.resumePublishing(key);
          console.error(
            JSON.stringify({
              eventId: row.event_id,
              requestId: payload.requestId,
              orderId: payload.orderId,
              correlationId: payload.correlationId,
              outcome: "retry",
              reason: error instanceof Error ? error.message : "publish failed",
            }),
          );
          break;
        }
      }
      return count;
    } finally {
      await db.execute(sql`SELECT pg_advisory_unlock(982344)`);
    }
  } finally {
    client.release();
  }
}
async function main() {
  // Cloud Run services must answer HTTP on PORT; locally (no PORT) none is started.
  // (Claude Code (Opus 5.5), 2026-10-18; author review: Pending.)
  const health = process.env.PORT
    ? createServer((_req, res) => res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}'))
        .listen(Number(process.env.PORT))
    : undefined;
  const pubsub = new PubSub({ projectId: config.projectId });
  const topic = pubsub.topic(config.creditTopic, {
    messageOrdering: true,
    gaxOpts: { timeout: 3000, retry: null },
  });
  let running = true;
  process.once("SIGTERM", () => {
    running = false;
  });
  process.once("SIGINT", () => {
    running = false;
  });
  while (running) {
    try {
      await publishBatch(topic);
    } catch (error) {
      console.error(
        "credit_publisher_retry",
        error instanceof Error ? error.message : "unknown",
      );
    }
    if (running) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await pubsub.close();
  await pool.end();
  health?.close();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
