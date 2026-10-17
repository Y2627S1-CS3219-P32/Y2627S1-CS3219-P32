/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Notification-service environment configuration. Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-17: shared store subscription. Author review: Pending.
 */
import "dotenv/config";

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function secret(name: string, purpose: string): string {
  const value = process.env[name];
  if (!value || Buffer.byteLength(value) < 32) throw new Error(`${name} must be set to at least 32 bytes (${purpose})`);
  return value;
}

export const config = {
  port: positiveInteger("PORT", 3000),
  jwtSecret: secret("JWT_SECRET", "the same secret as user-service"),
  // Shared by every instance, so any instance can verify a ticket another one issued.
  ticketSecret: secret("NOTIFICATION_TICKET_SECRET", "signs WebSocket tickets"),
  ticketTtlSeconds: positiveInteger("TICKET_TTL_SECONDS", 30),
  // Browser origins allowed to open a WebSocket; empty allows any origin.
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean),
  pubsub: {
    projectId: process.env.PUBSUB_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? "foc-local",
    emulatorHost: process.env.PUBSUB_EMULATOR_HOST || undefined,
    orderEventsTopic: process.env.ORDER_EVENTS_TOPIC ?? "order-events",
    subscriptionPrefix: process.env.SUBSCRIPTION_PREFIX ?? "notification",
    // Shared by all instances, for storing notifications.
    storeSubscription: process.env.STORE_SUBSCRIPTION ?? "notification-store",
  },
};
