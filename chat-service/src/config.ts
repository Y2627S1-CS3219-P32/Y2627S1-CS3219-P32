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

export const config = {
  port: positiveInteger("PORT", 3000),
  jwtSecret,
  pubsub: {
    projectId: process.env.PUBSUB_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? "foc-local",
    emulatorHost: process.env.PUBSUB_EMULATOR_HOST || undefined,
    orderEventsTopic: process.env.ORDER_EVENTS_TOPIC ?? "order-events",
    orderEventsSubscription: process.env.ORDER_EVENTS_SUBSCRIPTION ?? "chat-order-events-group-v3",
    chatTopicPrefix: process.env.CHAT_TOPIC_PREFIX ?? "order-chat-",
    chatSubscriptionPrefix: process.env.CHAT_SUBSCRIPTION_PREFIX ?? "chat-messages-",
  },
};
