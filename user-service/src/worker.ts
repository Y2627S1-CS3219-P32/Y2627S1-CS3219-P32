/**
    AI Assistance Disclosure:
    Tool: Copilot SDK in VS Code, 2026-10-15
    Scope: Pub/Sub push worker for the user PostgreSQL projection
    Author review: Pending
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Persist account verification fields from user events
    Author review: Pending
**/
import "dotenv/config";

import express, { type Request, type Response } from "express";

import { initializeDatabase, pool } from "./db";
import { parseUserEvent } from "./events/parse-user-event";
import {
  ensureUserEventsTopic,
  pubsub,
  userEventsTopic,
  userEventsTopicName,
} from "./events/user-events";
// Claude Code (Opus 5.5), 2026-11-04: logs through the shared pino logger. Author review: Pending.
import { logger } from "./shared/logger";
import { receivePush } from "./shared/messaging";

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
        `INSERT INTO users (
           id, name, display_name, email, role, "passwordHash",
           verification_status, verification_code
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           display_name = EXCLUDED.display_name,
           email = EXCLUDED.email,
           role = EXCLUDED.role,
           "passwordHash" = EXCLUDED."passwordHash",
           verification_status = EXCLUDED.verification_status,
           verification_code = EXCLUDED.verification_code`,
        [
          event.user.id,
          event.user.name,
          event.user.displayName,
          event.user.email,
          event.user.role,
          event.user.passwordHash,
          event.user.verificationStatus,
          event.user.verificationCode,
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
      logger.error({ err: rollbackError }, "Failed to roll back event transaction");
    }
    throw error;
  } finally {
    client.release();
  }
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Claude Code (Opus 5.5), 2026-11-05: in the message's trace, and logged with its outcome,
// through the shared helper. Author review: Pending.
app.post("/pubsub/user-events", receivePush(async (req: Request, res: Response) => {
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
    logger.error({ err: error }, "Invalid event payload");
    res.status(400).json({ error: "Invalid Pub/Sub user event" });
    return;
  }

  try {
    await applyUserEvent(event);
    res.status(204).end();
  } catch (error) {
    logger.error({ err: error, eventId: event.eventId }, "Failed to apply event");
    res.status(500).json({ error: "Could not apply Pub/Sub user event" });
  }
}));

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
      logger.info({ port, topic: userEventsTopicName }, "User event worker listening");
    });
  })
  .catch(async (error: unknown) => {
    logger.error({ err: error }, "Startup failed");
    await pool.end();
    process.exitCode = 1;
  });
