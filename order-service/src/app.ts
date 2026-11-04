/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Express routes for the student-defined order endpoints (POST /orders,
 * GET /orders, GET /orders/me, state actions) and internal routes for Pub/Sub
 * push, the expiry sweep, and the outbox relay; error handling as in supplier-service.
 * Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-17: GET /orders/:orderId, its event history, and
 * PATCH /orders/:orderId for editing. Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-17: joining group orders and group.placed from the sync
 * service. Author review: Pending.
 */
import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import { getUserId, requireInternal, requireUser } from "./auth.js";
import { applySupplierEvent, applyUserEvent, InvalidMessageError, parseGroupPlaced, parseSagaCommand } from "./events/consumers.js";
import { publishPendingEvents } from "./events/outbox.js";
import { decodePushMessage } from "./events/pubsub.js";
import { HttpError } from "./errors.js";
import { parseListQuery, parseOrderEdit, parseOrderInput, UUID_PATTERN } from "./orders/input.js";
import { getOrder, listOrderEvents, listOrders } from "./orders/queries.js";
import { createOrder, editOrder, expireOverdueOrders, joinOrder, placeGroupOrder, handleSagaCommand, performUserAction, USER_ACTIONS, type UserAction } from "./orders/write.js";

export const app = express();
app.use(express.json({ limit: "10kb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

function getOrderIdParam(req: Request): string {
  const id = req.params.orderId;
  // A malformed id cannot match a row, and would otherwise fail the uuid cast.
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) throw new HttpError(404, "Order not found");
  return id.toLowerCase();
}

async function sendOrder(res: Response, id: string, status = 200): Promise<void> {
  const order = await getOrder(id);
  if (!order) throw new HttpError(404, "Order not found");
  res.status(status).json(order);
}

// FR10.1: new orders start PENDING until the credit saga opens or rejects them.
app.post("/orders", requireUser, async (req, res) => {
  const id = await createOrder(getUserId(res), parseOrderInput(req.body));
  await sendOrder(res, id, 201);
});

// FR11.1: every signed-in user can browse every order; filters narrow the list.
app.get("/orders", requireUser, async (req, res) => {
  res.json(await listOrders(parseListQuery(req.query)));
});

// FR10.2: the caller's own requests. Registered before /orders/:orderId routes.
app.get("/orders/me", requireUser, async (req, res) => {
  res.json(await listOrders(parseListQuery(req.query), getUserId(res)));
});

app.get("/orders/:orderId", requireUser, async (req, res) => {
  await sendOrder(res, getOrderIdParam(req));
});

// The order's history, oldest first, for the order details page.
app.get("/orders/:orderId/events", requireUser, async (req, res) => {
  const id = getOrderIdParam(req);
  if (!await getOrder(id)) throw new HttpError(404, "Order not found");
  res.json(await listOrderEvents(id));
});

// The requester can edit the title, description and delivery location while OPEN.
app.patch("/orders/:orderId", requireUser, async (req, res) => {
  const id = getOrderIdParam(req);
  await editOrder(id, getUserId(res), parseOrderEdit(req.body));
  await sendOrder(res, id);
});

// Members join a group order through its shareable link while it is SYNCHRONISING.
app.post("/orders/:orderId/join", requireUser, async (req, res) => {
  const id = getOrderIdParam(req);
  await joinOrder(id, getUserId(res));
  await sendOrder(res, id);
});

for (const action of Object.keys(USER_ACTIONS) as UserAction[]) {
  app.post(`/orders/:orderId/${action}`, requireUser, async (req, res) => {
    const id = getOrderIdParam(req);
    await performUserAction(action, id, getUserId(res));
    await sendOrder(res, id);
  });
}

const internal = express.Router();
internal.use(requireInternal);

// Pub/Sub push: 204 acknowledges; 5xx makes Pub/Sub redeliver. Malformed messages
// are acknowledged (and logged) so they do not block their ordering key forever.
function pushHandler(name: string, handle: (message: unknown) => Promise<void>) {
  return async (req: Request, res: Response) => {
    const message = decodePushMessage(req.body);
    try {
      if (message === undefined) throw new InvalidMessageError("Push request has no JSON message data");
      await handle(message);
    } catch (error) {
      if (!(error instanceof InvalidMessageError)) throw error;
      console.error(`[order-service] Dropped invalid ${name} message: ${error.message}`);
    }
    res.status(204).end();
  };
}

internal.post("/pubsub/user-events", pushHandler("user-events", applyUserEvent));
internal.post("/pubsub/supplier-events", pushHandler("supplier-events", applySupplierEvent));
internal.post("/pubsub/order-commands", pushHandler("order-commands", async (message) => {
  const command = parseSagaCommand(message);
  const result = await handleSagaCommand(command);
  if (result !== "applied") console.log(`[order-service] ${command.type} ${command.commandId} for ${command.orderId}: ${result}`);
}));

internal.post("/pubsub/sync-events", pushHandler("sync-events", async (message) => {
  const placed = parseGroupPlaced(message);
  if (!placed) return;
  const result = await placeGroupOrder(placed);
  if (result !== "applied") console.log(`[order-service] group.placed ${placed.eventId} for ${placed.orderId}: ${result}`);
}));

// Called every minute by Cloud Scheduler (locally by the order-ticker container).
internal.post("/orders/expire-overdue", async (_req, res) => {
  res.json({ expired: await expireOverdueOrders() });
});

internal.post("/outbox/publish", async (_req, res) => {
  res.json({ published: await publishPendingEvents() });
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
  console.error("[order-service] Request failed", error);
  res.status(500).json({ error: "Internal server error" });
};

app.use(errorHandler);
