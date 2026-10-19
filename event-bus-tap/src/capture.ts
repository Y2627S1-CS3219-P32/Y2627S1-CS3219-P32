/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: Turns one received Pub/Sub message into the redacted record the tap keeps and
 * shows. Only redacted data is ever placed in the record. Author review: Pending.
 */
import { redactAttributes, redactValue, scrubString } from "./redact.js";

export type TopicKind = "command" | "event" | "message";
export type PayloadStatus = "json" | "not-json" | "too-large" | "empty";

export interface IncomingMessage {
  id: string;
  data: Buffer;
  attributes: Record<string, string>;
  orderingKey?: string | undefined;
  publishTime?: Date | null | undefined;
  deliveryAttempt?: number | undefined;
}

export type EventIds = Partial<Record<(typeof ID_FIELDS)[number], string | number>>;

export interface CapturedEvent {
  topic: string;
  kind: TopicKind;
  subscription: string;
  messageId: string;
  publishTime: string | null;
  receivedAt: string;
  orderingKey: string;
  deliveryAttempt: number | null;
  attributes: Record<string, string>;
  type: string | null;
  ids: EventIds;
  sizeBytes: number;
  payloadStatus: PayloadStatus;
  payload: unknown;
}

// Identifiers that link messages of one flow, in display order.
export const ID_FIELDS = [
  "orderId", "correlationId", "requestId", "commandId", "eventId", "userId", "supplierId", "sequence", "version",
] as const;

// Nested snapshots whose id is worth showing: user-events "user", supplier-events "supplier", order-events "order".
const NESTED_IDS: Array<[string, string, (typeof ID_FIELDS)[number]]> = [
  ["user", "id", "userId"],
  ["supplier", "id", "supplierId"],
  ["order", "id", "orderId"],
  ["order", "supplierId", "supplierId"],
];

export function topicKind(topic: string): TopicKind {
  if (topic.endsWith("-commands")) return "command";
  if (topic.endsWith("-events")) return "event";
  return "message";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function idValue(value: unknown): string | number | undefined {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value)) ? value : undefined;
}

// Reads ids from the already redacted payload and attributes, never from raw data.
function extractIds(payload: unknown, attributes: Record<string, string>): EventIds {
  const ids: EventIds = {};
  const sources: Array<Record<string, unknown>> = isRecord(payload) ? [payload, attributes] : [attributes];
  for (const field of ID_FIELDS) {
    for (const source of sources) {
      const value = idValue(source[field]);
      if (value !== undefined) {
        ids[field] = value;
        break;
      }
    }
  }
  if (isRecord(payload)) {
    for (const [parent, child, field] of NESTED_IDS) {
      const nested = payload[parent];
      const value = isRecord(nested) ? idValue(nested[child]) : undefined;
      if (value !== undefined && ids[field] === undefined) ids[field] = value;
    }
  }
  return ids;
}

function parsePayload(data: Buffer, maxPayloadBytes: number): { status: PayloadStatus; payload: unknown } {
  if (data.length === 0) return { status: "empty", payload: null };
  if (data.length > maxPayloadBytes) return { status: "too-large", payload: null };
  try {
    return { status: "json", payload: redactValue(JSON.parse(data.toString("utf8"))) };
  } catch {
    // Free text cannot be redacted reliably, so it is not kept at all.
    return { status: "not-json", payload: null };
  }
}

export function toCapturedEvent(
  topic: string,
  subscription: string,
  message: IncomingMessage,
  receivedAt: Date,
  maxPayloadBytes: number,
): CapturedEvent {
  const attributes = redactAttributes(message.attributes ?? {});
  const { status, payload } = parsePayload(message.data, maxPayloadBytes);
  const payloadType = isRecord(payload) ? payload.type : undefined;
  const type = typeof attributes.type === "string" ? attributes.type : typeof payloadType === "string" ? payloadType : null;
  const publishTime = message.publishTime instanceof Date && !Number.isNaN(message.publishTime.getTime())
    ? message.publishTime.toISOString()
    : null;
  return {
    topic,
    kind: topicKind(topic),
    subscription,
    messageId: scrubString(String(message.id)),
    publishTime,
    receivedAt: receivedAt.toISOString(),
    orderingKey: scrubString(message.orderingKey ?? ""),
    // The client reports 0 when the subscription has no dead-letter policy, i.e. unknown.
    deliveryAttempt: message.deliveryAttempt && message.deliveryAttempt > 0 ? message.deliveryAttempt : null,
    attributes,
    type,
    ids: extractIds(payload, attributes),
    sizeBytes: message.data.length,
    payloadStatus: status,
    payload,
  };
}
