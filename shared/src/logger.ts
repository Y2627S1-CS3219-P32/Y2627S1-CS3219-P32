/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-11-04.
 * Scope: Shared pino logger for the backend services, to the student's choices of pino,
 * Docker build contexts, redacted fields and pretty output in development. Author review: Pending.
 *
 * This is the only copy to edit. Each service's Dockerfile copies shared/src into its
 * src/shared/ from the `shared` build context; `node shared/sync.mjs` makes the same,
 * git-ignored copy for running a service outside Docker.
 *
 *   import { logger } from "./shared/logger.js";
 *   logger.info({ orderId }, "Order created");
 *   logger.error({ err: error }, "Outbox relay failed");
 *
 * Environment:
 *   LOG_LEVEL          trace | debug | info (default) | warn | error | fatal | silent
 *   LOG_PRETTY=true    human-readable output through pino-pretty (a dev dependency)
 *   OTEL_SERVICE_NAME  the `service` field; otherwise Cloud Run's K_SERVICE, then the
 *                      name in ./package.json
 */
import { readFileSync } from "node:fs";
import { pino } from "pino";

export type { Logger } from "pino";

// Cloud Logging takes the level from `severity` and the text from `message`.
const severities: Record<string, string> = {
  trace: "DEBUG",
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
  fatal: "CRITICAL",
};

// Matched at the top level of a log object and one level down.
const sensitiveFields = ["password", "passwordHash", "token", "accessToken", "refreshToken", "secret"];

const redactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  ...sensitiveFields.flatMap((field) => [field, `*.${field}`]),
];

function serviceName(): string {
  const configured = process.env.OTEL_SERVICE_NAME || process.env.K_SERVICE;
  if (configured) return configured;
  try {
    const { name } = JSON.parse(readFileSync("package.json", "utf8")) as { name?: unknown };
    if (typeof name === "string" && name) return name;
  } catch {
    // Not started from the service folder.
  }
  return "unknown-service";
}

const pretty = {
  target: "pino-pretty",
  options: {
    messageKey: "message",
    translateTime: "SYS:HH:MM:ss.l",
    ignore: "service,severity",
  },
};

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { service: serviceName() },
  messageKey: "message",
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label, severity: severities[label] ?? "DEFAULT" }),
  },
  redact: { paths: redactPaths, censor: "[REDACTED]" },
  ...(process.env.LOG_PRETTY === "true" ? { transport: pretty } : {}),
});
