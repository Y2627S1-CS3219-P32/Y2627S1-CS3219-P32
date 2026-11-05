/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-11-05.
 * Scope: A log line and a trace span for every Pub/Sub message a service publishes or
 * receives. The trace travels between services in the message attributes, and is kept
 * with each outbox row until the row is published. Author review: Pending.
 *
 * Publishing, with a topic from @google-cloud/pubsub:
 *
 *   const messageId = await publishMessage(topic, { json, orderingKey, attributes });
 *
 * Outbox rows are published later, by a relay, so each row keeps the trace it was
 * written in and the relay publishes it in that trace:
 *
 *   traceparent: text("traceparent").$defaultFn(() => currentTraceparent() ?? sql`null`),
 *   await withTraceparent(row.traceparent, () => publish(...));   // in the relay
 *
 * Receiving:
 *
 *   router.post("/pubsub/order-events", receivePush(async (req, res) => { ... }));   // push
 *   subscription.on("message", (message) =>
 *     processMessage(name, message, async () => "ack"));                             // pull
 *
 * Push takes a wrapped route handler rather than a middleware: the Express
 * instrumentation puts the HTTP request's span back as the current one at each next(), so
 * only the handler itself can run in the message's trace.
 *
 * Every message gets one log line on each side, which share its messageId and trace_id:
 *   "Published message"   topic, messageId, eventType, orderingKey, attributes
 *   "Processed message"   subscription, messageId, eventType, outcome (ack or nack),
 *                         durationMs, deliveryDelayMs (since it was published), and for
 *                         push, the statusCode returned to Pub/Sub. A message that is not
 *                         acknowledged is logged as a warning or error instead.
 *
 * Without OpenTelemetry (telemetry.mts not loaded, or off) there are no spans and no trace
 * attributes, and only the log lines remain.
 */
import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
} from "@opentelemetry/api";
import { logger } from "./logger.js";

const tracer = trace.getTracer("pubsub-messaging");

// The trace context travels in these attributes. They are left out of the logs, as is
// `type`, which is logged as eventType.
const unloggedAttributes = new Set(["traceparent", "tracestate", "baggage", "type"]);

// The last part of projects/<project>/topics/<name> or .../subscriptions/<name>.
function shortName(name: string): string {
  return name.slice(name.lastIndexOf("/") + 1);
}

function loggedAttributes(attributes: Record<string, string> | undefined) {
  const entries = Object.entries(attributes ?? {}).filter(([key]) => !unloggedAttributes.has(key));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** The traceparent of the current span: null outside a trace, or with telemetry off. */
export function currentTraceparent(): string | null {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent ?? null;
}

/** Runs fn in the trace a stored traceparent names. Without one, fn starts a new trace. */
export function withTraceparent<T>(traceparent: string | null | undefined, fn: () => T): T {
  const parent = traceparent ? propagation.extract(ROOT_CONTEXT, { traceparent }) : ROOT_CONTEXT;
  return context.with(parent, fn);
}

type OutgoingMessage = {
  data?: Buffer;
  json?: unknown;
  orderingKey?: string;
  attributes?: Record<string, string>;
};

type Topic = {
  name: string;
  publishMessage(message: OutgoingMessage): Promise<string>;
};

/** Publishes in a span of the current trace, adds the trace to the attributes, and logs it. */
export async function publishMessage(topic: Topic, message: OutgoingMessage): Promise<string> {
  const topicName = shortName(topic.name);
  const eventType = message.attributes?.type;
  const span = tracer.startSpan(`send ${topicName}`, {
    kind: SpanKind.PRODUCER,
    attributes: {
      "messaging.system": "gcp_pubsub",
      "messaging.operation.name": "send",
      "messaging.operation.type": "send",
      "messaging.destination.name": topicName,
      ...(message.orderingKey ? { "messaging.gcp_pubsub.message.ordering_key": message.orderingKey } : {}),
      ...(eventType ? { "messaging.message.event_type": eventType } : {}),
    },
  });
  const sending = trace.setSpan(context.active(), span);
  const attributes = { ...message.attributes };
  propagation.inject(sending, attributes);

  return context.with(sending, async () => {
    try {
      const messageId = await topic.publishMessage({ ...message, attributes });
      span.setAttribute("messaging.message.id", messageId);
      logger.info(
        {
          topic: topicName,
          messageId,
          eventType,
          orderingKey: message.orderingKey,
          attributes: loggedAttributes(message.attributes),
        },
        "Published message",
      );
      return messageId;
    } catch (error) {
      // The caller logs the failure, as it decides whether the message is retried.
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({ code: SpanStatusCode.ERROR, ...(error instanceof Error ? { message: error.message } : {}) });
      throw error;
    } finally {
      span.end();
    }
  });
}

type Delivery = {
  subscription: string;
  messageId?: string | undefined;
  attributes?: Record<string, string> | undefined;
  orderingKey?: string | undefined;
  deliveryAttempt?: number | undefined;
  publishTime?: Date | undefined;
};

type Level = "info" | "warn" | "error";

// A span for handling one message, in the trace that published it, and the log line that
// ends it.
function startProcessing(delivery: Delivery) {
  const eventType = delivery.attributes?.type;
  const attributes: Attributes = {
    "messaging.system": "gcp_pubsub",
    "messaging.operation.name": "process",
    "messaging.operation.type": "process",
    "messaging.destination.subscription.name": delivery.subscription,
  };
  if (delivery.messageId) attributes["messaging.message.id"] = delivery.messageId;
  if (delivery.orderingKey) attributes["messaging.gcp_pubsub.message.ordering_key"] = delivery.orderingKey;
  if (delivery.deliveryAttempt) attributes["messaging.gcp_pubsub.message.delivery_attempt"] = delivery.deliveryAttempt;
  if (eventType) attributes["messaging.message.event_type"] = eventType;

  // The publisher's span, when the message carries one. A push request's own span (which
  // Pub/Sub starts without trace context) is then linked instead of being the parent.
  const producer = propagation.extract(ROOT_CONTEXT, delivery.attributes ?? {});
  const hasProducer = trace.getSpanContext(producer) !== undefined;
  const request = trace.getSpanContext(context.active());
  const parent: Context = hasProducer ? producer : context.active();
  const span = tracer.startSpan(
    `process ${delivery.subscription}`,
    { kind: SpanKind.CONSUMER, attributes, links: hasProducer && request ? [{ context: request }] : [] },
    parent,
  );
  const processing = trace.setSpan(parent, span);

  const started = performance.now();
  const fields = {
    subscription: delivery.subscription,
    messageId: delivery.messageId,
    eventType,
    orderingKey: delivery.orderingKey,
    deliveryAttempt: delivery.deliveryAttempt || undefined,
    attributes: loggedAttributes(delivery.attributes),
    deliveryDelayMs: delivery.publishTime ? Date.now() - delivery.publishTime.getTime() : undefined,
  };

  let finished = false;
  function finish(level: Level, outcome: Record<string, unknown>, text: string, error?: unknown) {
    if (finished) return;
    finished = true;
    if (error !== undefined) span.recordException(error instanceof Error ? error : String(error));
    if (level === "error") span.setStatus({ code: SpanStatusCode.ERROR });
    context.with(processing, () => {
      const durationMs = Math.round(performance.now() - started);
      logger[level]({ ...fields, ...outcome, durationMs, ...(error === undefined ? {} : { err: error }) }, text);
    });
    span.end();
  }

  return { context: processing, finish };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const entries = Object.entries(record(value) ?? {}).filter(([, item]) => typeof item === "string");
  return entries.length > 0 ? (Object.fromEntries(entries) as Record<string, string>) : undefined;
}

function date(value: string | undefined): Date | undefined {
  const parsed = value ? new Date(value) : undefined;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
}

// Pub/Sub acknowledges a push message on these, and redelivers it on any other status.
const ACKNOWLEDGING_STATUSES = new Set([102, 200, 201, 202, 204]);

type PushRequest = { body?: unknown; path?: string | undefined };
type PushResponse = {
  statusCode: number;
  once(event: "finish" | "close", listener: () => void): unknown;
};

/**
 * Wraps the Express handler of a Pub/Sub push route (after express.json()): the handler runs
 * in the message's trace, and the response's status is logged as the outcome. Requests
 * without a push body go to the handler unchanged, for it to reject.
 */
export function receivePush<Args extends [PushRequest, PushResponse, ...unknown[]], Result>(
  handler: (...args: Args) => Result,
): (...args: Args) => Result {
  return (...args) => {
    const [req, res] = args;
    const body = record(req.body);
    const message = record(body?.message);
    if (!body || !message) return handler(...args);
    return context.with(startPush(req, res, body, message).context, () => handler(...args));
  };
}

function startPush(req: PushRequest, res: PushResponse, body: Record<string, unknown>, message: Record<string, unknown>) {
  const subscription = string(body.subscription);
  const processing = startProcessing({
    subscription: subscription ? shortName(subscription) : shortName(req.path ?? "unknown"),
    messageId: string(message.messageId) ?? string(message.message_id),
    attributes: stringRecord(message.attributes),
    orderingKey: string(message.orderingKey) ?? string(message.ordering_key),
    deliveryAttempt: typeof body.deliveryAttempt === "number" ? body.deliveryAttempt : undefined,
    publishTime: date(string(message.publishTime) ?? string(message.publish_time)),
  });

  res.once("finish", () => {
    const statusCode = res.statusCode;
    if (ACKNOWLEDGING_STATUSES.has(statusCode)) {
      processing.finish("info", { outcome: "ack", statusCode }, "Processed message");
    } else {
      processing.finish(
        statusCode >= 500 ? "error" : "warn",
        { outcome: "nack", statusCode },
        "Message not acknowledged; Pub/Sub will redeliver it",
      );
    }
  });
  // Only when the connection closes before a response (after one, finish has already run).
  res.once("close", () =>
    processing.finish("warn", { outcome: "nack" }, "Push request closed before a response"),
  );

  return processing;
}

type PulledMessage = {
  id: string;
  attributes: Record<string, string>;
  orderingKey?: string | undefined;
  deliveryAttempt?: number | undefined;
  publishTime?: Date | undefined;
  ack(): void;
  nack(): void;
};

type Outcome = "ack" | "nack";

/**
 * Handles a message from a pull subscription in the message's trace, then acknowledges it
 * or not as handle returns, and logs the outcome. If handle throws, the message is not
 * acknowledged, so Pub/Sub redelivers it. Never rejects.
 */
export async function processMessage(
  subscription: string,
  message: PulledMessage,
  handle: () => Outcome | Promise<Outcome>,
): Promise<void> {
  const processing = startProcessing({
    subscription,
    messageId: message.id,
    attributes: message.attributes,
    orderingKey: message.orderingKey,
    deliveryAttempt: message.deliveryAttempt,
    publishTime: message.publishTime,
  });
  let outcome: Outcome;
  try {
    outcome = await context.with(processing.context, handle);
  } catch (error) {
    message.nack();
    processing.finish("error", { outcome: "nack" }, "Failed to process message", error);
    return;
  }
  if (outcome === "ack") {
    message.ack();
    processing.finish("info", { outcome }, "Processed message");
  } else {
    message.nack();
    processing.finish("warn", { outcome }, "Message not acknowledged; Pub/Sub will redeliver it");
  }
}
