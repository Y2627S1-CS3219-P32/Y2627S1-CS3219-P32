/**AI Assistance Disclosure:
Tool: Claude Code (model: Opus 5.5), date: 2026-10-18
Scope: supplier-service Pub/Sub worker. Keeps the local users table in step with user-events,
and sets up (or repoints) the push subscription on the local emulator.
Author review: Pending.
Tool: Claude Code (model: Opus 5.5), date: 2026-10-18
Scope: POST /outbox/publish sweep that relays unpublished supplier-events, and the
supplier-events topic on the local emulator.
Author review: Pending. **/

import "dotenv/config";
import { pathToFileURL } from "node:url";
import { PubSub } from "@google-cloud/pubsub";
import express, { type ErrorRequestHandler } from "express";
import { pool } from "./db/index.js";
import { publishPendingSupplierEvents } from "./supplier-events.js";
import { applyUserEvent, InvalidUserEventError } from "./user-events.js";

const port = Number(process.env.PORT ?? 3004);
const projectId = process.env.PUBSUB_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? "foc-local";
const topicName = process.env.USER_EVENTS_TOPIC ?? "user-events";
const subscriptionName = process.env.PUBSUB_SUBSCRIPTION ?? "supplier-service-user-events";
const supplierEventsTopicName = process.env.SUPPLIER_EVENTS_TOPIC ?? "supplier-events";

export const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// The JSON carried by a Pub/Sub push request, or undefined if it is malformed.
function decodePushMessage(body: unknown): unknown {
  const message = typeof body === "object" && body !== null ? (body as Record<string, unknown>).message : undefined;
  const data = typeof message === "object" && message !== null ? (message as Record<string, unknown>).data : undefined;
  if (typeof data !== "string") return undefined;
  try {
    return JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}

// 204 acknowledges; 5xx makes Pub/Sub redeliver. Malformed messages are acknowledged
// (and logged) so they do not block their ordering key forever.
app.post("/pubsub/user-events", async (req, res) => {
  const message = decodePushMessage(req.body);
  try {
    if (message === undefined) throw new InvalidUserEventError("Push request has no JSON message data");
    await applyUserEvent(message);
  } catch (error) {
    if (!(error instanceof InvalidUserEventError)) throw error;
    console.error(`[supplier-event-worker] Dropped invalid user event: ${error.message}`);
  }
  res.status(204).end();
});

// Called every minute by Cloud Scheduler (locally by the supplier-ticker container) to
// publish outbox rows that the API's relay after each commit did not.
app.post("/outbox/publish", async (_req, res) => {
  res.json({ published: await publishPendingSupplierEvents() });
});

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error("[supplier-event-worker] Request failed", error);
  res.status(500).json({ error: "Internal server error" });
};

app.use(errorHandler);

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 6;
}

// Local development only: the emulator starts empty. In Cloud, deploy.sh creates these.
async function ensureEmulatorResources(): Promise<void> {
  if (!process.env.PUBSUB_EMULATOR_HOST) return;
  const pushEndpoint = process.env.PUBSUB_PUSH_ENDPOINT;
  if (!pushEndpoint) throw new Error("PUBSUB_PUSH_ENDPOINT is required when using the Pub/Sub emulator");

  const pubsub = new PubSub({ projectId });
  for (const name of [topicName, supplierEventsTopicName]) {
    await pubsub.createTopic(name).catch((error: unknown) => {
      if (!isAlreadyExists(error)) throw error;
    });
  }
  await pubsub.topic(topicName).createSubscription(subscriptionName, { pushEndpoint, enableMessageOrdering: true })
    .catch(async (error: unknown) => {
      if (!isAlreadyExists(error)) throw error;
      // An existing subscription may still push to an old endpoint.
      await pubsub.subscription(subscriptionName).modifyPushConfig({ pushEndpoint });
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ensureEmulatorResources()
    .then(() => {
      app.listen(port, "0.0.0.0", (error) => {
        if (error) throw error;
        console.log(`[supplier-event-worker] Listening on port ${port} for ${topicName}`);
      });
    })
    .catch(async (error: unknown) => {
      console.error("[supplier-event-worker] Startup failed", error);
      await pool.end();
      process.exitCode = 1;
    });
}
