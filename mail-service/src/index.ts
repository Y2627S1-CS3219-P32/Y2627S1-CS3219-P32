/**
    AI Assistance Disclosure:
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Mail service startup, email senders, and local Pub/Sub subscription
    Author review: Pending
**/
import { PubSub } from "@google-cloud/pubsub";

import { createApp } from "./app";
import { config } from "./config";
import {
  createVerificationEmailSender,
  createWelcomeEmailSender,
} from "./welcome-email";

const app = createApp(config.mailjet
  ? {
      sendWelcomeEmail: createWelcomeEmailSender(config.mailjet),
      sendVerificationEmail: createVerificationEmailSender(config.mailjet),
    }
  : {});

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 6;
}

async function ensureLocalSubscription(): Promise<void> {
  if (!config.useEmulator) return;
  if (!config.pushEndpoint) {
    throw new Error("PUBSUB_PUSH_ENDPOINT is required when using the Pub/Sub emulator");
  }

  const pubsub = new PubSub({ projectId: config.projectId });
  const topic = pubsub.topic(config.topicName);
  await pubsub.createTopic(config.topicName).catch((error: unknown) => {
    if (!isAlreadyExists(error)) throw error;
  });
  await topic.createSubscription(config.subscriptionName, {
    pushEndpoint: config.pushEndpoint,
  }).catch(async (error: unknown) => {
    if (!isAlreadyExists(error)) throw error;
    await pubsub.subscription(config.subscriptionName).modifyPushConfig({
      pushEndpoint: config.pushEndpoint,
    });
  });
}

ensureLocalSubscription()
  .then(() => {
    app.listen(config.port, "0.0.0.0", (error) => {
      if (error) throw error;
      console.log(`[mail-service] Listening on port ${config.port}`);
    });
  })
  .catch((error: unknown) => {
    console.error("[mail-service] Startup failed", error);
    process.exitCode = 1;
  });
