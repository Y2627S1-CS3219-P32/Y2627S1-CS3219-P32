/**
    AI Assistance Disclosure:
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Pub/Sub push endpoint for verification and welcome emails
    Author review: Pending
    Tool: Claude Code (Opus 5.5), date: 2026-11-10
    Scope: logging through the shared pino logger; each pushed message is logged and traced
    by the shared helper
    Author review: Pending
**/
import express, { type ErrorRequestHandler } from "express";

import { logger } from "./shared/logger";
import { receivePush } from "./shared/messaging";
import { InvalidUserEventError, processUserEvent } from "./user-events";
import type {
  EmailUpdatedRecipient,
  PasswordResetEmailRecipient,
  VerificationEmailRecipient,
  WelcomeEmailRecipient,
} from "./welcome-email";

export function createApp(
  senders: {
    sendWelcomeEmail?: (recipient: WelcomeEmailRecipient) => Promise<void>;
    sendEmailUpdatedEmail?: (recipient: EmailUpdatedRecipient) => Promise<void>;
    sendPasswordResetEmail?: (recipient: PasswordResetEmailRecipient) => Promise<void>;
    sendVerificationEmail?: (recipient: VerificationEmailRecipient) => Promise<void>;
  },
) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  const handlePush = receivePush(async (req: express.Request, res: express.Response) => {
    const message = typeof req.body === "object" && req.body !== null
      ? (req.body as Record<string, unknown>).message
      : undefined;
    const encodedData = typeof message === "object" && message !== null
      ? (message as Record<string, unknown>).data
      : undefined;
    if (typeof encodedData !== "string") {
      logger.error("Dropped Pub/Sub request without message data");
      res.status(204).end();
      return;
    }

    let event: unknown;
    try {
      event = JSON.parse(Buffer.from(encodedData, "base64").toString("utf8"));
    } catch (error) {
      logger.error({ err: error }, "Dropped malformed Pub/Sub event JSON");
      res.status(204).end();
      return;
    }

    try {
      await processUserEvent(event, senders);
      res.status(204).end();
    } catch (error) {
      if (error instanceof InvalidUserEventError) {
        logger.error({ reason: error.message }, `Dropped invalid user event: ${error.message}`);
        res.status(204).end();
        return;
      }
      logger.error({ err: error }, "Failed to send user email");
      res.status(500).json({ error: "Could not process user event" });
    }
  });
  app.post("/pubsub/user-events", handlePush);
  app.post("/pubsub/password-reset", handlePush);

  app.use(((error, _req, res, _next) => {
    logger.error({ err: error }, "Request failed");
    res.status(500).json({ error: "Internal server error" });
  }) satisfies ErrorRequestHandler);

  return app;
}
