/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: The sync service's subscriptions: order events shared by all instances (each
 * applied once, retried until it succeeds), and a relay subscription per instance that
 * receives the other instances' document updates and status changes. Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-17: relayed presence. Author review: Pending.
 * Claude Code (Opus 5.5), 2026-11-10: each message is handled in the trace that published it
 * and logged with its outcome, through the shared helper; relayed edits and presence at
 * debug. Logging through the shared pino logger. Author review: Pending.
 */
import type { Message, Subscription } from "@google-cloud/pubsub";
import { config } from "./config.js";
import { applyRelayedAwareness, applyRelayedUpdate, applyStatus } from "./documents.js";
import { applyOrderEvent, ORDER_EVENTS_FILTER } from "./order-events.js";
import { instanceId, isAlreadyExists, publish, pubsub } from "./pubsub.js";
import type { DocumentStatus } from "./db/schema.js";
import { logger } from "./shared/logger.js";
import { processMessage } from "./shared/messaging.js";

const ignoreExisting = (error: unknown) => {
  if (!isAlreadyExists(error)) throw error;
};

export async function startSubscriptions(): Promise<() => Promise<void>> {
  const client = pubsub();
  if (config.pubsub.emulatorHost) {
    for (const topic of [config.pubsub.orderEventsTopic, config.pubsub.syncEventsTopic, config.pubsub.syncUpdatesTopic]) {
      await client.createTopic(topic).catch(ignoreExisting);
    }
  }

  const orderEvents = client.topic(config.pubsub.orderEventsTopic);
  await orderEvents.createSubscription(config.pubsub.orderEventsSubscription, {
    filter: ORDER_EVENTS_FILTER,
    enableMessageOrdering: true,
  }).catch(ignoreExisting);
  const shared = orderEvents.subscription(config.pubsub.orderEventsSubscription);
  shared.on("message", (message: Message) =>
    processMessage(config.pubsub.orderEventsSubscription, message, async () => {
      let event: unknown;
      try {
        event = JSON.parse(message.data.toString("utf8"));
      } catch (error) {
        logger.error({ err: error }, "Dropped unreadable order event");
        return "ack";
      }
      try {
        const status = await applyOrderEvent(event);
        if (status) {
          const orderId = String((event as Record<string, unknown>).orderId).toLowerCase();
          applyStatus(orderId, status);
          await publish.relay(orderId, { kind: "status", status }, new Uint8Array());
        }
        return "ack";
      } catch (error) {
        logger.error({ err: error }, "Could not apply order event");
        return "nack";
      }
    }));
  shared.on("error", (error) => logger.error({ err: error }, "Order events subscription error"));

  // This instance's relay subscription, without its own messages.
  const relayName = `${config.pubsub.relayPrefix}-${instanceId}`;
  const [relay]: [Subscription, ...unknown[]] = await client.topic(config.pubsub.syncUpdatesTopic).createSubscription(relayName, {
    filter: `attributes.origin != "${instanceId}"`,
    messageRetentionDuration: { seconds: 600 },
    expirationPolicy: { ttl: { seconds: 24 * 60 * 60 } },
  });
  relay.on("message", (message: Message) => {
    const { orderId, kind, status } = message.attributes;
    return processMessage(relayName, message, async () => {
      try {
        if (orderId && kind === "update") await applyRelayedUpdate(orderId, new Uint8Array(message.data));
        if (orderId && kind === "awareness") applyRelayedAwareness(orderId, new Uint8Array(message.data));
        if (orderId && kind === "status" && status) applyStatus(orderId, status as DocumentStatus);
      } catch (error) {
        logger.error({ err: error, orderId, kind }, `Could not apply relayed ${kind ?? "message"} for ${orderId}`);
      }
      return "ack" as const;
    }, { level: kind === "status" ? "info" : "debug" });
  });
  relay.on("error", (error) => logger.error({ err: error }, "Relay subscription error"));

  return async () => {
    await Promise.all([shared.close(), relay.close()]);
    await relay.delete().catch((error: unknown) => logger.error({ err: error }, "Could not delete relay subscription"));
    await client.close();
  };
}
