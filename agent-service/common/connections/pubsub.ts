// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-11-10.
// Scope: messages published and processed through the shared Pub/Sub messaging (common/shared/,
// a copy of shared/src): a log line on each side and, with telemetry on, a span in the trace
// that published the message. Author review: Pending.
import { PubSub, v1 } from '@google-cloud/pubsub';
import type { z } from 'zod';
import { parseBounded, turnSchema, approvalSchema } from '../../contracts/events.js';
import { processDelivery, publishMessage, type Delivery } from '../shared/messaging.js';

export interface BrokerDelivery<T> {
  event: T;
  ack(): Promise<void>;
  renew(seconds?: number): Promise<void>;
  defer(): Promise<void>;
  /** The message as received, for its log line and trace. */
  message?: Delivery;
}

// A protobuf Timestamp, whose seconds may be a number, string or Long.
function timestamp(value: { seconds?: unknown; nanos?: number | null } | null | undefined) {
  if (value?.seconds == null) return undefined;
  const ms = Number(value.seconds) * 1000 + Math.floor((value.nanos ?? 0) / 1e6);
  return Number.isFinite(ms) ? new Date(ms) : undefined;
}
export function createBroker(projectId: string, emulator = process.env.PUBSUB_EMULATOR_HOST) {
  if (!projectId || !/^[a-z][a-z0-9-]+$/.test(projectId))
    throw new Error('Invalid Pub/Sub project');
  const options = { projectId, ...(emulator ? { apiEndpoint: emulator } : {}) };
  const publisher = new PubSub(options);
  const subscriber = new v1.SubscriberClient({ ...publisher.options });
  const topics = new Map<string, ReturnType<PubSub['topic']>>();
  const subscriptionPath = (name: string) => {
    if (!/^[a-zA-Z][\w.-]{2,254}$/.test(name)) throw new Error('Invalid subscription');
    return subscriber.subscriptionPath(projectId, name);
  };
  async function publish<T>(
    topic: string,
    schema: z.ZodType<T>,
    value: T,
    orderingKey = '',
    attributes: Record<string, string> = {},
  ) {
    const event = parseBounded(schema, value);
    if (!/^[a-zA-Z][\w.-]{2,254}$/.test(topic)) throw new Error('Invalid topic');
    let handle = topics.get(topic);
    if (!handle) {
      handle = publisher.topic(topic, {
        messageOrdering: true,
        batching: { maxMessages: 1 },
        gaxOpts: { timeout: 10_000 },
      });
      topics.set(topic, handle);
    }
    try {
      return await publishMessage(handle, {
        data: Buffer.from(JSON.stringify(orderingKey ? turnSchema.parse(event).data : event)),
        orderingKey,
        attributes,
      });
    } catch (error) {
      if (orderingKey) handle.resumePublishing(orderingKey);
      throw error;
    }
  }
  async function pull<T>(
    name: string,
    schema: z.ZodType<T>,
    signal: AbortSignal,
    turn = false,
  ): Promise<BrokerDelivery<T> | null> {
    signal.throwIfAborted();
    const subscription = subscriptionPath(name);
    const result = await subscriber
      .pull({ subscription, maxMessages: 1 }, { timeout: 5_000, retry: null })
      .catch((error: unknown) => {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 4)
          return null;
        throw error;
      });
    if (!result) return null;
    const [batch] = result;
    const received = batch.receivedMessages?.[0];
    if (!received?.ackId) return null;
    const ackId = received.ackId;
    const renew = async (seconds = 30) => {
      await subscriber.modifyAckDeadline(
        { subscription, ackIds: [ackId], ackDeadlineSeconds: seconds },
        { timeout: 5_000, retry: null },
      );
    };
    try {
      signal.throwIfAborted();
      const bytes = received.message?.data;
      if (!bytes || bytes.length > 65_536) throw new Error('Invalid event body');
      const body: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
      const event = parseBounded(
        schema,
        turn
          ? {
              data: body,
              ordering_key: received.message?.orderingKey,
              attributes: received.message?.attributes,
            }
          : body,
      );
      const message = received.message;
      return {
        event,
        message: {
          subscription: name,
          messageId: message?.messageId ?? undefined,
          attributes: message?.attributes ?? undefined,
          orderingKey: message?.orderingKey ?? undefined,
          deliveryAttempt: received.deliveryAttempt ?? undefined,
          publishTime: timestamp(message?.publishTime),
          data: Buffer.from(bytes),
        },
        renew,
        async ack() {
          await subscriber.acknowledge(
            { subscription, ackIds: [ackId] },
            { timeout: 5_000, retry: null },
          );
        },
        async defer() {
          await renew(0);
        },
      };
    } catch (error) {
      await renew(0);
      throw error;
    }
  }
  return {
    async ready(topicNames: string[] = [], subscriptionNames: string[] = []) {
      await Promise.all([
        ...topicNames.map((name) => publisher.topic(name).get({ timeout: 2000, retry: null })),
        ...subscriptionNames.map((name) =>
          subscriber.getSubscription(
            { subscription: subscriptionPath(name) },
            { timeout: 2000, retry: null },
          ),
        ),
      ]);
    },
    publishTurn: (topic: string, value: z.infer<typeof turnSchema>) =>
      publish(
        topic,
        turnSchema,
        value,
        value.ordering_key,
        Object.fromEntries(
          Object.entries(value.attributes).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
      ),
    publishApproval: (topic: string, value: z.infer<typeof approvalSchema>) =>
      publish(topic, approvalSchema, value),
    pullTurn: (name: string, signal: AbortSignal) => pull(name, turnSchema, signal, true),
    pullApproval: (name: string, signal: AbortSignal) => pull(name, approvalSchema, signal),
    async close() {
      await Promise.all([...topics.values()].map((topic) => topic.flush()));
      await Promise.all([publisher.close(), subscriber.close()]);
    },
  };
}

// No business consumer starts implicitly. Handler success is the commit boundary.
export async function consume<T>(input: {
  pull(signal: AbortSignal): Promise<BrokerDelivery<T> | null>;
  handle(event: T, signal: AbortSignal): Promise<void>;
  signal: AbortSignal;
  concurrency?: number;
  onError(error: unknown): void;
}): Promise<void> {
  const concurrency = input.concurrency ?? 50;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 1000)
    throw new Error('Invalid consumer concurrency');
  async function worker() {
    while (!input.signal.aborted) {
      let delivery: BrokerDelivery<T> | null = null;
      let timer: ReturnType<typeof setInterval> | undefined;
      const lease = new AbortController();
      const signal = AbortSignal.any([input.signal, lease.signal, AbortSignal.timeout(120_000)]);
      // Set once processDelivery has logged a failure itself.
      let logged = false;
      try {
        delivery = await input.pull(input.signal);
        if (!delivery) continue;
        const current = delivery;
        await current.renew();
        timer = setInterval(() => {
          void current.renew().catch((error) => {
            lease.abort(error);
            input.onError(error);
          });
        }, 10_000);
        const run = async () => {
          await input.handle(current.event, signal);
          if (signal.aborted) return 'nack' as const;
          await current.ack();
          return 'ack' as const;
        };
        if (current.message) {
          logged = true;
          await processDelivery(current.message, run);
        } else await run();
      } catch (error) {
        if (!input.signal.aborted && !logged) input.onError(error);
        if (delivery) await delivery.defer().catch(input.onError);
        if (!input.signal.aborted) await new Promise((resolve) => setTimeout(resolve, 200));
      } finally {
        if (timer) clearInterval(timer);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}

let connection: ReturnType<typeof createBroker> | undefined;
export function brokerConnection() {
  const project = process.env.PUBSUB_PROJECT_ID;
  if (!project) throw new Error('Missing PUBSUB_PROJECT_ID');
  return (connection ??= createBroker(project));
}
export async function closeBrokerConnection() {
  await connection?.close();
  connection = undefined;
}
