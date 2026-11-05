/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Pub/Sub publishing for the sync service: relaying document updates and status
 * changes to the other instances (sync-updates) and group.placed for the order service
 * (sync-events). Tests replace the publisher. Author review: Pending.
 */
import { randomUUID } from "node:crypto";
import { PubSub } from "@google-cloud/pubsub";
import { config } from "./config.js";

// Identifies this instance's own relay messages, so it can filter them out.
export const instanceId = randomUUID();

let client: PubSub | undefined;
export function pubsub(): PubSub {
  client ??= new PubSub({ projectId: config.pubsub.projectId });
  return client;
}

export interface Publisher {
  relay(orderId: string, attributes: Record<string, string>, data: Uint8Array): Promise<void>;
  syncEvent(event: Record<string, unknown>, orderingKey: string): Promise<void>;
}

let publisher: Publisher = {
  async relay(orderId, attributes, data) {
    await pubsub().topic(config.pubsub.syncUpdatesTopic).publishMessage({
      data: Buffer.from(data),
      attributes: { ...attributes, orderId, origin: instanceId },
    });
  },
  async syncEvent(event, orderingKey) {
    const topic = pubsub().topic(config.pubsub.syncEventsTopic, { messageOrdering: true });
    try {
      await topic.publishMessage({ json: event, orderingKey, attributes: { type: String(event.type) } });
    } catch (error) {
      topic.resumePublishing(orderingKey);
      throw error;
    }
  },
};

export const publish = {
  relay: (orderId: string, attributes: Record<string, string>, data: Uint8Array) => publisher.relay(orderId, attributes, data),
  syncEvent: (event: Record<string, unknown>, orderingKey: string) => publisher.syncEvent(event, orderingKey),
};

export function setPublisher(replacement: Publisher): void {
  publisher = replacement;
}

export function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 6;
}
