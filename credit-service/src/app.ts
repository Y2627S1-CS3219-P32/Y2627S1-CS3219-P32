import express from "express";
import type { NextFunction, Request, Response } from "express";
import { internal, userId } from "./auth.js";
import { CreditError } from "./credit/types.js";
import { parseCommand } from "./events/commands.js";
import { decodeMessage } from "./events/messages.js";
import { db } from "./db/index.js";
import { sql } from "drizzle-orm";
import type { execute } from "./credit/commands.js";
import type { userEvent } from "./credit/accounts.js";
import type { balance, reservation, lookup } from "./credit/queries.js";
export type CreditApi = {
  execute: typeof execute;
  userEvent: typeof userEvent;
  balance: typeof balance;
  reservation: typeof reservation;
  lookup: typeof lookup;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function id(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value))
    throw new CreditError(400, "INVALID_INPUT");
  return value.toLowerCase();
}
export function createApp(credit: CreditApi) {
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", async (_req, res) => {
    await db.execute(sql`SELECT 1`);
    res.json({ status: "ok" });
  });
  app.get("/api/v1/credits/me", async (req, res) =>
    res.json(await credit.balance(userId(req))),
  );
  app.post("/internal/pubsub/user-events", async (req, res) => {
    await internal(req, true);
    const event = decodeMessage(req.body);
    await credit.userEvent(event);
    res.status(200).json({ status: "ok" });
  });
  app.post("/internal/pubsub/credit-commands", async (req, res) => {
    await internal(req, true);
    const command = parseCommand(decodeMessage(req.body));
    await credit.execute(command);
    res.sendStatus(204);
  });
  app.get("/internal/v1/credit-orders/:requestId", async (req, res) => {
    await internal(req);
    const result = await credit.lookup(id(req.params.requestId));
    if (!result) throw new CreditError(404, "NOT_FOUND");
    res.json(result);
  });
  app.get("/internal/v1/credit-reservations/:orderId", async (req, res) => {
    await internal(req);
    const result = await credit.reservation(id(req.params.orderId));
    if (!result || result.reservationState === "NONE")
      throw new CreditError(404, "NOT_FOUND");
    res.json(result);
  });
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const status =
        error instanceof CreditError
          ? error.status
          : error instanceof SyntaxError
            ? 400
            : 503;
      if (status === 503) res.set("retry-after", "2");
      if (!(error instanceof CreditError))
        console.error(
          "credit_request_failed",
          error instanceof Error ? error.message : "unknown",
        );
      res.status(status).json({
        code:
          error instanceof CreditError
            ? error.code
            : status === 400
              ? "INVALID_INPUT"
              : "DEPENDENCY_UNAVAILABLE",
      });
    },
  );
  return app;
}
