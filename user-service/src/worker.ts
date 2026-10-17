/**
    AI Assistance Disclosure:
    Tool: Copilot SDK in VS Code, 2026-10-15
    Scope: Pub/Sub push worker for the user PostgreSQL projection
    Author review: Pending
**/
import "dotenv/config";

import express from "express";

import { initializeDatabase, pool } from "./db";
import { parseUserEvent } from "./events/parse-user-event";
import {
  ensureUserEventsTopic,
  pubsub,
  userEventsTopic,
  userEventsTopicName,
} from "./events/user-events";

const port = Number(process.env.PORT ?? 3334);
const subscriptionName = process.env.PUBSUB_SUBSCRIPTION ?? "user-events-worker";

const app = express();
app.use(express.json({ limit: "1mb" }));

async function applyUserEvent(event: ReturnType<typeof parseUserEvent>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userId = event.type === "user.deleted" ? event.userId : event.user.id;
    const state = await client.query(
      `INSERT INTO user_event_states (user_id, version, deleted)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         version = EXCLUDED.version,
         deleted = EXCLUDED.deleted
       WHERE user_event_states.version < EXCLUDED.version
       RETURNING user_id`,
      [userId, event.version, event.type === "user.deleted"],
    );
    if (state.rowCount === 0) {
      await client.query("COMMIT");
      return;
    }

    if (event.type === "user.deleted") {
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
    } else {
      await client.query(
        `INSERT INTO users (id, name, display_name, email, role, "passwordHash")
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           display_name = EXCLUDED.display_name,
           email = EXCLUDED.email,
           role = EXCLUDED.role,
           "passwordHash" = EXCLUDED."passwordHash"`,
        [
          event.user.id,
          event.user.name,
          event.user.displayName,
          event.user.email,
          event.user.role,
          event.user.passwordHash,
        ],
      );
      if (event.user.role === "admin") {
        await client.query("DELETE FROM user_bootstrap_reservations WHERE id = 1");
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("[user-event-worker] Failed to roll back event transaction", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/pubsub/user-events", async (req, res) => {
  const message = typeof req.body === "object" && req.body !== null
    ? (req.body as Record<string, unknown>).message
    : undefined;
  const encodedData = typeof message === "object" && message !== null
    ? (message as Record<string, unknown>).data
    : undefined;

  if (typeof encodedData !== "string") {
    res.status(400).json({ error: "Pub/Sub push message data is required" });
    return;
  }

  let event;
  try {
    event = parseUserEvent(JSON.parse(Buffer.from(encodedData, "base64").toString("utf8")));
  } catch (error) {
    console.error("[user-event-worker] Invalid event payload", error);
    res.status(400).json({ error: "Invalid Pub/Sub user event" });
    return;
  }

  try {
    await applyUserEvent(event);
    res.status(204).end();
  } catch (error) {
    console.error(`[user-event-worker] Failed to apply event ${event.eventId}`, error);
    res.status(500).json({ error: "Could not apply Pub/Sub user event" });
  }
});

async function ensureLocalSubscription(): Promise<void> {
  if (!process.env.PUBSUB_EMULATOR_HOST) return;
  await ensureUserEventsTopic();
  const pushEndpoint = process.env.PUBSUB_PUSH_ENDPOINT;
  if (!pushEndpoint) {
    throw new Error("PUBSUB_PUSH_ENDPOINT is required when using the Pub/Sub emulator");
  }

  const subscription = pubsub.subscription(subscriptionName);
  const [exists] = await subscription.exists();
  if (!exists) {
    await userEventsTopic.createSubscription(subscriptionName, {
      pushEndpoint,
      enableMessageOrdering: true,
    });
  }
}

initializeDatabase()
  .then(ensureLocalSubscription)
  .then(() => {
    app.listen(port, () => {
      console.log(`[user-event-worker] Listening on port ${port} for ${userEventsTopicName}`);
    });
  })
  .catch(async (error: unknown) => {
    console.error("[user-event-worker] Startup failed", error);
    await pool.end();
    process.exitCode = 1;
  });
