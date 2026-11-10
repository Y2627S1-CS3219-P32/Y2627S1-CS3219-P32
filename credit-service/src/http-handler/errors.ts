import type { NextFunction, Request, Response } from "express";
import { CreditError } from "../common/types.js";
// Claude Code (Opus 5.5), 2026-11-04: logs through the shared pino logger. Author review: Pending.
import { logger } from "../shared/logger.js";

const statuses: Record<string, number> = {
  INVALID_INPUT: 400,
  INVALID_COMMAND: 400,
  INVALID_EVENT: 400,
  UNAUTHORIZED: 401,
  USER_INACTIVE: 401,
  IDEMPOTENCY_CONFLICT: 409,
  ACCOUNT_PENDING: 503,
  RESERVATION_NOT_READY: 503,
};

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  const status =
    error instanceof CreditError
      ? (statuses[error.code] ?? 503)
      : error instanceof SyntaxError
        ? 400
        : 503;
  if (status === 503) res.set("retry-after", "2");
  if (!(error instanceof CreditError))
    logger.error(
      { reason: error instanceof Error ? error.message : "unknown" },
      "credit_request_failed",
    );
  res.status(status).json({
    code:
      error instanceof CreditError
        ? error.code
        : status === 400
          ? "INVALID_INPUT"
          : "DEPENDENCY_UNAVAILABLE",
  });
}
