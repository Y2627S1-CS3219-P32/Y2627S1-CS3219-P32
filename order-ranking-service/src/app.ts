/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
 * Scope: Express routes for ranked open orders and courier preferences, internal
 * Pub/Sub push routes for order-events and supplier-events, and the embedding job
 * route; error handling as in order-service. Author review: Pending.
 * Claude Code (Opus 5.5), 2026-11-01. Scope: Supplier changes start embedding. Author review: Pending.
 */
import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import { getUserId, requireInternal, requireUser } from "./auth.js";
import { config } from "./config.js";
import { applyOrderEvent, applySupplierEvent, InvalidMessageError } from "./events/consumers.js";
import { decodePushMessage } from "./events/pubsub.js";
import { HttpError } from "./errors.js";
import { processPendingEmbeddings, requestEmbedding } from "./ranking/embedding-job.js";
import { getPreferences, parseLimit, parseLocation, parsePreferences, rankOpenOrders, savePreferences } from "./ranking/queries.js";

export const app = express();
app.use(express.json({ limit: "10kb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Open orders ranked for the caller, each with its score, parts and reasons.
// Optional ?lat=&lng= is the caller's current location.
app.get("/rankings", requireUser, async (req, res) => {
  const query = req.query as Record<string, unknown>;
  res.json(await rankOpenOrders(getUserId(res), parseLocation(query), parseLimit(query.limit)));
});

app.get("/preferences/me", requireUser, async (_req, res) => {
  const prefs = await getPreferences(getUserId(res));
  res.json({
    supplierTypes: prefs?.supplierTypes ?? [],
    buildings: prefs?.buildings ?? [],
    minReward: prefs?.minReward ?? null,
    note: prefs?.note ?? null,
  });
});

app.put("/preferences/me", requireUser, async (req, res) => {
  const input = parsePreferences(req.body);
  await savePreferences(getUserId(res), input);
  res.json(input);
});

const internal = express.Router();
internal.use(requireInternal);

// Pub/Sub push: 204 acknowledges; 5xx makes Pub/Sub redeliver. Malformed messages are
// acknowledged (and logged) so they do not block their ordering key forever.
function pushHandler(name: string, handle: (message: unknown) => Promise<void>) {
  return async (req: Request, res: Response) => {
    const message = decodePushMessage(req.body);
    try {
      if (message === undefined) throw new InvalidMessageError("Push request has no JSON message data");
      await handle(message);
    } catch (error) {
      if (!(error instanceof InvalidMessageError)) throw error;
      console.error(`[order-ranking-service] Dropped invalid ${name} message: ${error.message}`);
    }
    res.status(204).end();
  };
}

internal.post("/pubsub/order-events", pushHandler("order-events", async (message) => {
  // Embedding runs after the acknowledgement, so it never delays or fails the event.
  if (await applyOrderEvent(message)) void requestEmbedding();
}));
internal.post("/pubsub/supplier-events", pushHandler("supplier-events", async (message) => {
  if (await applySupplierEvent(message)) void requestEmbedding();
}));

// Called every minute by Cloud Scheduler (locally by the ticker) to retry failed embeddings.
internal.post("/embeddings/process", async (_req, res) => {
  res.json({ provider: config.embedding.provider, embedded: await processPendingEmbeddings() });
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
  console.error("[order-ranking-service] Request failed", error);
  res.status(500).json({ error: "Internal server error" });
};

app.use(errorHandler);
