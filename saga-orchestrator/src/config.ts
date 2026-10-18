/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
 * Scope: Saga orchestrator environment configuration. Author review: Pending.
 */
import "dotenv/config";

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

const internalSharedSecret = process.env.INTERNAL_SHARED_SECRET || undefined;
if (internalSharedSecret && Buffer.byteLength(internalSharedSecret) < 32) {
  throw new Error("INTERNAL_SHARED_SECRET must be at least 32 bytes when configured");
}

export const config = {
  port: positiveInteger("PORT", 3000),
  // How long to wait for credit's answer to a reservation before aborting the order.
  reserveTimeoutSeconds: positiveInteger("RESERVE_TIMEOUT_SECONDS", 60),
  // Internal routes (Pub/Sub push, Cloud Scheduler): a Google OIDC token from an allowed
  // service account, or, for local development only, a shared secret.
  internalSharedSecret,
  internalAudience: process.env.INTERNAL_AUDIENCE || undefined,
  internalInvokerEmails: (process.env.INTERNAL_INVOKER_EMAILS ?? "")
    .split(",").map((email) => email.trim()).filter(Boolean),
  pubsub: {
    projectId: process.env.PUBSUB_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? "foc-local",
    emulatorHost: process.env.PUBSUB_EMULATOR_HOST || undefined,
    pushBaseUrl: process.env.PUBSUB_PUSH_BASE_URL || undefined,
    orderEventsTopic: process.env.ORDER_EVENTS_TOPIC ?? "order-events",
    orderCommandsTopic: process.env.ORDER_COMMANDS_TOPIC ?? "order-commands",
    creditEventsTopic: process.env.CREDIT_EVENTS_TOPIC ?? "credit-events",
    creditCommandsTopic: process.env.CREDIT_COMMANDS_TOPIC ?? "credit-commands",
  },
};
