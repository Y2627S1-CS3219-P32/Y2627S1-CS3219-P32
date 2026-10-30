/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Order-service environment configuration. Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-17: sync-events topic for group orders. Author review: Pending.
 */
import "dotenv/config";

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || Buffer.byteLength(jwtSecret) < 32) {
  throw new Error("JWT_SECRET must be set to at least 32 bytes (the same secret as user-service)");
}

const internalSharedSecret = process.env.INTERNAL_SHARED_SECRET || undefined;
if (internalSharedSecret && Buffer.byteLength(internalSharedSecret) < 32) {
  throw new Error("INTERNAL_SHARED_SECRET must be at least 32 bytes when configured");
}

export const config = {
  port: positiveInteger("PORT", 3000),
  jwtSecret,
  // How long an order stays OPEN before the expiry sweep moves it to EXPIRED (FR13.2).
  openOrderTtlSeconds: positiveInteger("ORDER_OPEN_TTL_SECONDS", 2 * 60 * 60),
  // Internal routes (Pub/Sub push, Cloud Scheduler) accept either a Google-signed
  // OIDC token for an allowed service account, or, for local development only,
  // a shared secret in the x-internal-secret header or the token query parameter.
  internalSharedSecret,
  internalAudience: process.env.INTERNAL_AUDIENCE || undefined,
  internalInvokerEmails: (process.env.INTERNAL_INVOKER_EMAILS ?? "")
    .split(",").map((email) => email.trim()).filter(Boolean),
  pubsub: {
    projectId: process.env.PUBSUB_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? "foc-local",
    emulatorHost: process.env.PUBSUB_EMULATOR_HOST || undefined,
    // Base URL the emulator pushes to, e.g. http://order-service:3000 (local only).
    pushBaseUrl: process.env.PUBSUB_PUSH_BASE_URL || undefined,
    orderEventsTopic: process.env.ORDER_EVENTS_TOPIC ?? "order-events",
    userEventsTopic: process.env.USER_EVENTS_TOPIC ?? "user-events",
    supplierEventsTopic: process.env.SUPPLIER_EVENTS_TOPIC ?? "supplier-events",
    orderCommandsTopic: process.env.ORDER_COMMANDS_TOPIC ?? "order-commands",
    syncEventsTopic: process.env.SYNC_EVENTS_TOPIC ?? "sync-events",
  },
};
