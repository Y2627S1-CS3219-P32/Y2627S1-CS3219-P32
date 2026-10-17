/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: A pull subscription per instance, so every instance receives every order event
 * and delivers it to the sockets it holds. Filtered on the type attribute; expires if
 * the instance disappears without deleting it. Author review: Pending.
 */
import { randomUUID } from "node:crypto";
import { PubSub, type Subscription } from "@google-cloud/pubsub";
import { config } from "./config.js";
import { routeOrderEvent } from "./order-events.js";

export const ORDER_EVENTS_FILTER = 'hasPrefix(attributes.type, "order.")';

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 6;
}

export async function subscribeToOrderEvents(): Promise<{ name: string; stop: () => Promise<void> }> {
  const pubsub = new PubSub({ projectId: config.pubsub.projectId });
  const topic = pubsub.topic(config.pubsub.orderEventsTopic);
  // Locally the emulator starts empty; in Cloud the topic already exists.
  if (config.pubsub.emulatorHost) {
    await pubsub.createTopic(config.pubsub.orderEventsTopic).catch((error: unknown) => {
      if (!isAlreadyExists(error)) throw error;
    });
  }

  const name = `${config.pubsub.subscriptionPrefix}-${randomUUID()}`;
  const [subscription]: [Subscription, ...unknown[]] = await topic.createSubscription(name, {
    filter: ORDER_EVENTS_FILTER,
    enableMessageOrdering: true,
    // Live notifications only: nothing is worth delivering after 10 minutes.
    messageRetentionDuration: { seconds: 600 },
    // Deleted automatically after a day without a subscriber (e.g. a crashed instance).
    expirationPolicy: { ttl: { seconds: 24 * 60 * 60 } },
  });

  subscription.on("message", (message) => {
    try {
      routeOrderEvent(JSON.parse(message.data.toString("utf8")));
    } catch (error) {
      console.error("[notification-service] Dropped unreadable order event", error);
    }
    // Delivered or not, the event is done: users who are offline re-fetch on connect.
    message.ack();
  });
  subscription.on("error", (error) => console.error("[notification-service] Subscription error", error));

  return {
    name,
    stop: async () => {
      await subscription.close();
      await subscription.delete().catch((error: unknown) => console.error("[notification-service] Could not delete subscription", error));
      await pubsub.close();
    },
  };
}
