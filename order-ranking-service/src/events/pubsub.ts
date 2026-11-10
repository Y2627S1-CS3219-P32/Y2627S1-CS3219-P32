/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
 * Scope: Pub/Sub push-message decoding and push-subscription setup on the local
 * emulator, adapted from order-service/src/events/pubsub.ts. This service only
 * consumes events. Author review: Pending.
 */
import { PubSub } from "@google-cloud/pubsub";
import { config } from "../config.js";

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

  const pubsub = new PubSub({ projectId: config.pubsub.projectId });
  for (const name of [config.pubsub.orderEventsTopic, config.pubsub.supplierEventsTopic]) {
    await pubsub.createTopic(name).catch((error: unknown) => {
      if (!isAlreadyExists(error)) throw error;
    });
  }

  // The emulator cannot send OIDC tokens, so the push URL carries the shared secret.
  const subscriptions = [
    ["order-ranking-service-order-events", config.pubsub.orderEventsTopic, "order-events"],
    ["order-ranking-service-supplier-events", config.pubsub.supplierEventsTopic, "supplier-events"],
  ] as const;
  for (const [name, topic, path] of subscriptions) {
    const pushEndpoint = `${pushBaseUrl}/internal/pubsub/${path}?token=${encodeURIComponent(internalSharedSecret)}`;
    await pubsub.topic(topic).createSubscription(name, { pushEndpoint, enableMessageOrdering: true })
      .catch((error: unknown) => {
        if (!isAlreadyExists(error)) throw error;
      });
  }
  await pubsub.close();
}
