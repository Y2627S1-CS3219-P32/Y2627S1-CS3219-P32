import express from "express";
import type { NextFunction, Request, Response } from "express";
import { internal, userId } from "./auth.js";
import { CreditError, type Command } from "./credit/types.js";
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
function integer(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 2147483647
  )
    throw new CreditError(400, "INVALID_INPUT");
  return value;
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
  app.use("/internal", async (req, _res, next) => {
    await internal(req, req.path === "/pubsub/user-events");
    next();
  });
  app.post("/internal/pubsub/user-events", async (req, res) => {
    const data = req.body?.message?.data;
    if (typeof data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
      throw new CreditError(400, "INVALID_EVENT");
    let event: unknown;
    try {
      event = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
    } catch {
      throw new CreditError(400, "INVALID_EVENT");
    }
    await credit.userEvent(event);
    res.status(200).json({ status: "ok" });
  });
  for (const kind of ["RESERVE", "TRANSFER", "RELEASE"] as const) {
    const path =
      kind === "RESERVE"
        ? "/internal/v1/credit-reservations"
        : `/internal/v1/credit-reservations/:orderId/${kind.toLowerCase()}`;
    app.post(path, async (req, res) => {
      const b = req.body;
      if (!b || typeof b !== "object")
        throw new CreditError(400, "INVALID_INPUT");
      const base = {
        requestId: id(b.requestId),
        correlationId: id(b.correlationId),
        orderId: id(kind === "RESERVE" ? b.orderId : req.params.orderId),
      };
      let command: Command;
      if (kind === "TRANSFER")
        command = { ...base, kind, courierId: integer(b.courierId) };
      else {
        const fields = {
          requesterId: integer(b.requesterId),
          amount: integer(b.amount),
        };
        if (kind === "RELEASE") {
          if (
            typeof b.reason !== "string" ||
            !b.reason.trim() ||
            b.reason.length > 200
          )
            throw new CreditError(400, "INVALID_INPUT");
          command = { ...base, ...fields, kind, reason: b.reason };
        } else command = { ...base, ...fields, kind };
      }
      const result = await credit.execute(command);
      console.log(
        JSON.stringify({
          requestId: command.requestId,
          orderId: command.orderId,
          correlationId: command.correlationId,
          outcome: result.status,
          code: result.code,
        }),
      );
      res
        .status(result.httpStatus ?? (result.status === "REJECTED" ? 409 : 200))
        .json(result);
    });
  }
  app.get("/internal/v1/credit-orders/:requestId", async (req, res) => {
    const result = await credit.lookup(id(req.params.requestId));
    if (!result) throw new CreditError(404, "NOT_FOUND");
    res.json(result);
  });
  app.get("/internal/v1/credit-reservations/:orderId", async (req, res) => {
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
