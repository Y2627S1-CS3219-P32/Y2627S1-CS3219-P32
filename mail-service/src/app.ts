/**
    AI Assistance Disclosure:
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Pub/Sub push endpoint for user-created welcome emails
    Author review: Pending
**/
import express, { type ErrorRequestHandler } from "express";

import { InvalidUserEventError, processUserEvent } from "./user-events";
import type { WelcomeEmailRecipient } from "./welcome-email";

export function createApp(
  sendWelcomeEmail: ((recipient: WelcomeEmailRecipient) => Promise<void>) | undefined,
) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

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
      console.error("[mail-service] Dropped Pub/Sub request without message data");
      res.status(204).end();
      return;
    }

    let event: unknown;
    try {
      event = JSON.parse(Buffer.from(encodedData, "base64").toString("utf8"));
    } catch (error) {
      console.error("[mail-service] Dropped malformed Pub/Sub event JSON", error);
      res.status(204).end();
      return;
    }

    try {
      await processUserEvent(event, sendWelcomeEmail);
      res.status(204).end();
    } catch (error) {
      if (error instanceof InvalidUserEventError) {
        console.error("[mail-service] Dropped invalid user event", error.message);
        res.status(204).end();
        return;
      }
      console.error("[mail-service] Failed to send welcome email", error);
      res.status(500).json({ error: "Could not process user event" });
    }
  });

  app.use(((error, _req, res, _next) => {
    console.error("[mail-service] Request failed", error);
    res.status(500).json({ error: "Internal server error" });
  }) satisfies ErrorRequestHandler);

  return app;
}
