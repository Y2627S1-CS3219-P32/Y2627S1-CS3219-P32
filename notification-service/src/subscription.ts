/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: A pull subscription per instance, so every instance receives every order event
 * and delivers it to the sockets it holds. Filtered on the type attribute; expires if
 * the instance disappears without deleting it. Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-17: a shared subscription for storing notifications,
 * which Pub/Sub splits between instances and retries until stored. Author review: Pending.
 */
import { randomUUID } from "node:crypto";
import { PubSub, type Message, type Subscription } from "@google-cloud/pubsub";
import { config } from "./config.js";
import { routeOrderEvent } from "./order-events.js";
import { routeCreditEvent } from "./credit-events.js";
import { notificationsForCreditEvent, notificationsForOrderEvent, type Notification } from "./rules.js";
import { storeNotifications } from "./store.js";

export const ORDER_EVENTS_FILTER = 'hasPrefix(attributes.type, "order.")';

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 6;
}

function parse(message: Message): unknown {
  return JSON.parse(message.data.toString("utf8"));
}

type EventSource = {
  topic: string;
  storeSubscription: string;
  filter: string;
  route: (event: unknown) => unknown;
  notifications: (event: unknown) => Notification[];
};

async function subscribe(pubsub: PubSub, source: EventSource) {
  const topic = pubsub.topic(source.topic);
  if (config.pubsub.emulatorHost) {
    await pubsub.createTopic(source.topic).catch((error: unknown) => {
      if (!isAlreadyExists(error)) throw error;
    });
  }

  const name = `${config.pubsub.subscriptionPrefix}-${randomUUID()}`;
  const [live]: [Subscription, ...unknown[]] = await topic.createSubscription(name, {
    filter: source.filter,
    enableMessageOrdering: true,
    messageRetentionDuration: { seconds: 600 },
    expirationPolicy: { ttl: { seconds: 24 * 60 * 60 } },
  });
  const store = topic.subscription(source.storeSubscription);
  const stop = async () => {
    await Promise.allSettled([live.close(), store.close()]);
    await live.delete().catch((error: unknown) => console.error("[notification-service] Could not delete subscription", error));
  };
  try {
    await topic.createSubscription(source.storeSubscription, {
      filter: source.filter,
      enableMessageOrdering: true,
    }).catch((error: unknown) => {
      if (!isAlreadyExists(error)) throw error;
    });
    live.on("message", (message) => {
      try {
        source.route(parse(message));
      } catch (error) {
        console.error(`[notification-service] Dropped unreadable event from ${source.topic}`, error);
      }
      message.ack();
    });
    live.on("error", (error) => console.error("[notification-service] Live subscription error", error));
    store.on("message", async (message) => {
      let event: unknown;
      try {
        event = parse(message);
      } catch (error) {
        console.error(`[notification-service] Dropped unreadable event from ${source.topic}`, error);
        message.ack();
        return;
      }
      try {
        await storeNotifications(source.notifications(event));
        message.ack();
      } catch (error) {
        console.error("[notification-service] Could not store notifications", error);
        message.nack();
      }
    });
    store.on("error", (error) => console.error("[notification-service] Store subscription error", error));
    return { name, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

export async function subscribeToEvents() {
  const pubsub = new PubSub({ projectId: config.pubsub.projectId });
  const subscriptions: Awaited<ReturnType<typeof subscribe>>[] = [];
  const stop = async () => {
    await Promise.allSettled(subscriptions.map((subscription) => subscription.stop()));
    await pubsub.close();
  };
  try {
    for (const source of [
      {
        topic: config.pubsub.orderEventsTopic,
        storeSubscription: config.pubsub.storeSubscription,
        filter: ORDER_EVENTS_FILTER,
        route: routeOrderEvent,
        notifications: notificationsForOrderEvent,
      },
      {
        topic: config.pubsub.creditEventsTopic,
        storeSubscription: config.pubsub.creditStoreSubscription,
        filter: 'hasPrefix(attributes.type, "credit.")',
        route: routeCreditEvent,
        notifications: notificationsForCreditEvent,
      },
    ]) subscriptions.push(await subscribe(pubsub, source));
    return { name: subscriptions.map((subscription) => subscription.name).join(", "), stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
