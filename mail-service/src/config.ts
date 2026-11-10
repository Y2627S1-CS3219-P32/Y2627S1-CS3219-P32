/**
    AI Assistance Disclosure:
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Mail service runtime and Mailjet configuration
    Author review: Pending
**/
import "dotenv/config";

const mailjetApiKey = process.env.MAILJET_API_KEY?.trim();
const mailjetSecretKey = process.env.MAILJET_SECRET_KEY?.trim();
const mailjetFrom = process.env.MAILJET_FROM?.trim();
const mailjetSettings = [mailjetApiKey, mailjetSecretKey, mailjetFrom];
if (mailjetSettings.some(Boolean) && !mailjetSettings.every(Boolean)) {
  throw new Error("MAILJET_API_KEY, MAILJET_SECRET_KEY, and MAILJET_FROM must all be set together");
}

export const config = {
  port: Number(process.env.PORT ?? 3335),
  projectId: process.env.PUBSUB_PROJECT_ID
    ?? process.env.GOOGLE_CLOUD_PROJECT
    ?? "foc-local",
  topicName: process.env.PUBSUB_TOPIC ?? "user-events",
  subscriptionName: process.env.PUBSUB_SUBSCRIPTION ?? "mail-service-user-events",
  pushEndpoint: process.env.PUBSUB_PUSH_ENDPOINT,
  useEmulator: Boolean(process.env.PUBSUB_EMULATOR_HOST),
  mailjet: mailjetApiKey && mailjetSecretKey && mailjetFrom
    ? { apiKey: mailjetApiKey, secretKey: mailjetSecretKey, from: mailjetFrom }
    : undefined,
};
