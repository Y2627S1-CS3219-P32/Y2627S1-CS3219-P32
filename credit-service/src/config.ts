import "dotenv/config";
export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET ?? "",
  initialCredits: BigInt(process.env.INITIAL_CREDITS ?? "1000"),
  internalAudience: process.env.INTERNAL_AUDIENCE,
  internalInvokerEmails: (process.env.INTERNAL_INVOKER_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  pushInvokerEmail: process.env.PUBSUB_PUSH_SERVICE_ACCOUNT,
  internalSharedSecret: process.env.PUBSUB_EMULATOR_HOST
    ? process.env.INTERNAL_SHARED_SECRET
    : undefined,
  projectId: process.env.PUBSUB_PROJECT_ID ?? "foc-local",
  creditTopic: process.env.CREDIT_EVENTS_TOPIC ?? "credit-events",
  userTopic: process.env.USER_EVENTS_TOPIC ?? "user-events",
  subscription:
    process.env.USER_EVENTS_SUBSCRIPTION ?? "credit-service-user-events",
  pushBaseUrl: process.env.PUBSUB_PUSH_BASE_URL ?? "http://credit-service:3000",
};
