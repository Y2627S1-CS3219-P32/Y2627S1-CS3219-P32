/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Pub/Sub publishing with ordering keys, push-message decoding, and topic
 * and push-subscription setup on the local emulator (as user-service does).
 * Author review: Pending.
 */
import { PubSub } from "@google-cloud/pubsub";
import { config } from "../config.js";

export type Publisher = (topic: string, data: unknown, orderingKey: string) => Promise<void>;

let client: PubSub | undefined;
function pubsub(): PubSub {
  client ??= new PubSub({ projectId: config.pubsub.projectId });
  return client;
}

const publishToPubSub: Publisher = async (topicName, data, orderingKey) => {
  const topic = pubsub().topic(topicName, { messageOrdering: true });
  try {
    await topic.publishMessage({ json: data, orderingKey });
  } catch (error) {
    // An ordering key pauses after a failure until resumed.
    topic.resumePublishing(orderingKey);
    throw error;
  }
};

let publisher: Publisher = publishToPubSub;

export function publish(topic: string, data: unknown, orderingKey: string): Promise<void> {
  return publisher(topic, data, orderingKey);
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

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 6;
}

// Local development only: the emulator starts empty. In Cloud, deploy.sh creates these.
export async function ensureEmulatorResources(): Promise<void> {
  if (!config.pubsub.emulatorHost) return;
  const pushBaseUrl = config.pubsub.pushBaseUrl;
  const internalSharedSecret = config.internalSharedSecret;
  if (!pushBaseUrl || !internalSharedSecret) {
    throw new Error("PUBSUB_PUSH_BASE_URL and INTERNAL_SHARED_SECRET are required with the Pub/Sub emulator");
  }

  const topics = [
    config.pubsub.orderEventsTopic,
    config.pubsub.userEventsTopic,
    config.pubsub.supplierEventsTopic,
    config.pubsub.orderCommandsTopic,
  ];
  for (const name of topics) {
    await pubsub().createTopic(name).catch((error: unknown) => {
      if (!isAlreadyExists(error)) throw error;
    });
  }

  // The emulator cannot send OIDC tokens, so the push URL carries the shared secret.
  const subscriptions = [
    ["order-service-user-events", config.pubsub.userEventsTopic, "user-events"],
    ["order-service-supplier-events", config.pubsub.supplierEventsTopic, "supplier-events"],
    ["order-service-order-commands", config.pubsub.orderCommandsTopic, "order-commands"],
  ] as const;
  for (const [name, topic, path] of subscriptions) {
    const pushEndpoint = `${pushBaseUrl}/internal/pubsub/${path}?token=${encodeURIComponent(internalSharedSecret)}`;
    await pubsub().topic(topic).createSubscription(name, { pushEndpoint, enableMessageOrdering: true })
      .catch((error: unknown) => {
        if (!isAlreadyExists(error)) throw error;
      });
  }
}
