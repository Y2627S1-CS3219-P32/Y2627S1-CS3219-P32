/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
 * Scope: Pub/Sub publishing with ordering keys and attributes, push-message decoding, and
 * topic and push-subscription setup on the local emulator, as in order-service.
 * Author review: Pending.
 */
import { PubSub } from "@google-cloud/pubsub";
import { config } from "./config.js";

export type Publisher = (topic: string, data: unknown, orderingKey: string, attributes: Record<string, string>) => Promise<void>;

let client: PubSub | undefined;
function pubsub(): PubSub {
  client ??= new PubSub({ projectId: config.pubsub.projectId });
  return client;
}

let publisher: Publisher = async (topicName, data, orderingKey, attributes) => {
  const topic = pubsub().topic(topicName, { messageOrdering: true });
  try {
    await topic.publishMessage({ json: data, orderingKey, attributes });
  } catch (error) {
    topic.resumePublishing(orderingKey);
    throw error;
  }
};

export function publish(topic: string, data: unknown, orderingKey: string, attributes: Record<string, string>): Promise<void> {
  return publisher(topic, data, orderingKey, attributes);
}

// Tests replace Pub/Sub with an in-memory publisher.
export function setPublisher(replacement: Publisher): void {
  publisher = replacement;
}

// The JSON carried by a Pub/Sub push request, or undefined if it is malformed.
export function decodePushMessage(body: unknown): unknown {
  const message = typeof body === "object" && body !== null ? (body as Record<string, unknown>).message : undefined;
  const data = typeof message === "object" && message !== null ? (message as Record<string, unknown>).data : undefined;
  if (typeof data !== "string") return undefined;
  try {
    return JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}

function ignoreExisting(error: unknown): void {
  if (!(typeof error === "object" && error !== null && "code" in error && error.code === 6)) throw error;
}

// The order events the saga reacts to; the rest (its own commands' results) are filtered out.
export const ORDER_EVENTS_FILTER = ["order.created", "order.cancelled", "order.expired", "order.completed"]
  .map((type) => `attributes.type = "${type}"`).join(" OR ");

// Local development only: the emulator starts empty. In Cloud, deployment creates these.
export async function ensureEmulatorResources(): Promise<void> {
  const { emulatorHost, pushBaseUrl } = config.pubsub;
  if (!emulatorHost) return;
  if (!pushBaseUrl || !config.internalSharedSecret) {
    throw new Error("PUBSUB_PUSH_BASE_URL and INTERNAL_SHARED_SECRET are required with the Pub/Sub emulator");
  }
  for (const name of [config.pubsub.orderEventsTopic, config.pubsub.orderCommandsTopic, config.pubsub.creditEventsTopic, config.pubsub.creditCommandsTopic]) {
    await pubsub().createTopic(name).catch(ignoreExisting);
  }
  const token = `?token=${encodeURIComponent(config.internalSharedSecret)}`;
  await pubsub().topic(config.pubsub.orderEventsTopic).createSubscription("saga-orchestrator-order-events", {
    pushEndpoint: `${pushBaseUrl}/internal/pubsub/order-events${token}`,
    filter: ORDER_EVENTS_FILTER,
    enableMessageOrdering: true,
  }).catch(ignoreExisting);
  await pubsub().topic(config.pubsub.creditEventsTopic).createSubscription("saga-orchestrator-credit-events", {
    pushEndpoint: `${pushBaseUrl}/internal/pubsub/credit-events${token}`,
    enableMessageOrdering: true,
  }).catch(ignoreExisting);
}
