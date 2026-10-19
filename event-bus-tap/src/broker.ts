/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: The tap's only use of the Pub/Sub client: list topics, create, inspect, pull
 * from and delete its own subscriptions. Author review: Pending.
 */
import { PubSub, type Message } from "@google-cloud/pubsub";
import type { IncomingMessage } from "./capture.js";
import type { TapConfig } from "./config.js";

export interface ReceivedMessage extends IncomingMessage {
  ack(): void;
}

export interface SubscriptionListener {
  message(message: ReceivedMessage): void;
  error(error: Error): void;
}

export interface SubscriptionHandle {
  close(): Promise<void>;
}

export interface SubscriptionInfo {
  topic: string;
  push: boolean;
}

export interface Broker {
  listTopics(): Promise<string[]>;
  createSubscription(topic: string, name: string): Promise<void>;
  getSubscription(name: string): Promise<SubscriptionInfo | null>;
  open(name: string, listener: SubscriptionListener): SubscriptionHandle;
  deleteSubscription(name: string): Promise<void>;
  close(): Promise<void>;
}

const NOT_FOUND = 5;

function shortName(path: string | null | undefined): string {
  return (path ?? "").split("/").at(-1) ?? "";
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === NOT_FOUND;
}

export class PubSubBroker implements Broker {
  readonly #client: PubSub;

  constructor(config: TapConfig) {
    // Otherwise the auth library probes for a Google metadata server even with the emulator.
    if (config.mode === "emulator") process.env.METADATA_SERVER_DETECTION ??= "none";
    this.#client = config.mode === "emulator"
      // Explicit, so the client never looks for Google credentials in emulator mode.
      ? new PubSub({ projectId: config.projectId, apiEndpoint: config.emulatorHost!, emulatorMode: true })
      : new PubSub({ projectId: config.projectId });
  }

  async listTopics(): Promise<string[]> {
    const [topics] = await this.#client.getTopics({ gaxOpts: { timeout: 5000 } });
    return topics.map((topic) => shortName(topic.name));
  }

  async createSubscription(topic: string, name: string): Promise<void> {
    await this.#client.topic(topic).createSubscription(name, {
      // Delivery order per ordering key, as the application consumers see it.
      enableMessageOrdering: true,
      ackDeadlineSeconds: 60,
      // A live view: nothing is worth delivering ten minutes late.
      messageRetentionDuration: { seconds: 600 },
      // Removed by Pub/Sub after a day unused, if the tap dies without cleaning up.
      expirationPolicy: { ttl: { seconds: 24 * 60 * 60 } },
    });
  }

  async getSubscription(name: string): Promise<SubscriptionInfo | null> {
    try {
      const [metadata] = await this.#client.subscription(name).getMetadata({ timeout: 5000 });
      return { topic: shortName(metadata.topic as string | undefined), push: Boolean(metadata.pushConfig?.pushEndpoint) };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  open(name: string, listener: SubscriptionListener): SubscriptionHandle {
    const subscription = this.#client.subscription(name, {
      flowControl: { maxMessages: 100, allowExcessMessages: false },
    });
    subscription.on("message", (message: Message) => listener.message({
      id: message.id,
      data: message.data,
      attributes: message.attributes,
      orderingKey: message.orderingKey,
      publishTime: message.publishTime,
      deliveryAttempt: message.deliveryAttempt,
      ack: () => message.ack(),
    }));
    subscription.on("error", (error: Error) => listener.error(error));
    return {
      close: async () => {
        subscription.removeAllListeners("message");
        // The error listener stays: an "error" emitted with no listener would crash the process.
        await subscription.close();
      },
    };
  }

  async deleteSubscription(name: string): Promise<void> {
    await this.#client.subscription(name).delete().catch((error: unknown) => {
      if (!isNotFound(error)) throw error;
    });
  }

  // Used by the emulator-only cleanup command.
  async listSubscriptionNames(): Promise<string[]> {
    const [subscriptions] = await this.#client.getSubscriptions({ gaxOpts: { timeout: 5000 } });
    return subscriptions.map((subscription) => shortName(subscription.name));
  }

  async close(): Promise<void> {
    await this.#client.close();
  }
}
