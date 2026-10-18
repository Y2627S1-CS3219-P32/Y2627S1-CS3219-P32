/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
 * Scope: Internal routes for the saga orchestrator: Pub/Sub push for order events and
 * credit results, the reservation timeout sweep, and the outbox relay.
 * Author review: Pending.
 */
import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import { requireInternal } from "./auth.js";
import { HttpError } from "./errors.js";
import { InvalidMessageError, parseCreditResult, parseOrderEvent } from "./messages.js";
import { publishPending } from "./outbox.js";
import { decodePushMessage } from "./pubsub.js";
import { abortOverdueReservations, handleCreditResult, handleOrderEvent, type Outcome } from "./saga.js";

export const app = express();
app.use(express.json({ limit: "64kb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const internal = express.Router();
internal.use(requireInternal);

// Pub/Sub push: 204 acknowledges; 5xx makes Pub/Sub redeliver. Malformed messages are
// logged and acknowledged so they cannot block their ordering key.
function pushHandler(name: string, handle: (message: unknown) => Promise<Outcome | undefined>) {
  return async (req: Request, res: Response) => {
    const message = decodePushMessage(req.body);
    try {
      if (message === undefined) throw new InvalidMessageError("Push request has no JSON message data");
      const outcome = await handle(message);
      if (outcome && outcome !== "applied") console.log(`[saga-orchestrator] ${name} message: ${outcome}`);
    } catch (error) {
      if (!(error instanceof InvalidMessageError)) throw error;
      console.error(`[saga-orchestrator] Dropped invalid ${name} message: ${error.message}`);
    }
    res.status(204).end();
  };
}

internal.post("/pubsub/order-events", pushHandler("order-events", async (message) => {
  const event = parseOrderEvent(message);
  return event ? handleOrderEvent(event) : undefined;
}));

internal.post("/pubsub/credit-events", pushHandler("credit-events", async (message) => {
  const result = parseCreditResult(message);
  return result ? handleCreditResult(result) : undefined;
}));

internal.post("/sagas/abort-overdue", async (_req, res) => {
  res.json({ aborted: await abortOverdueReservations() });
});

internal.post("/outbox/publish", async (_req, res) => {
  res.json({ published: await publishPending() });
});

app.use("/internal", internal);

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.set(error.headers).status(error.statusCode).json({ error: error.message });
    return;
  }
  if (error instanceof SyntaxError && "status" in error && error.status === 400) {
    res.status(400).json({ error: "Request body contains invalid JSON" });
    return;
  }
  console.error("[saga-orchestrator] Request failed", error);
  res.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);
