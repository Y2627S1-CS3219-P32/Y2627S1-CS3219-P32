import { randomUUID } from "node:crypto";
import { and, eq, isNull, lte } from "drizzle-orm";
import { PubSub, type Message, type Subscription } from "@google-cloud/pubsub";
import { db } from "./db/index.js";
import { chatMessages, chatRoomMembers, chatRooms } from "./db/schema.js";
import { config } from "./config.js";
import { canAccessChat } from "./access.js";
import { chatExpiresAt } from "./retention.js";

const ORDER_EVENTS_FILTER = [
  'attributes.type = "order.group_started"',
  'attributes.type = "order.member_joined"',
  'attributes.type = "order.created"',
  'attributes.type = "order.accepted"',
  'attributes.type = "order.deleted"',
  'attributes.type = "order.cancelled"',
  'attributes.type = "order.expired"',
  'attributes.type = "order.completed"',
].join(" OR ");
const MESSAGE_BODY_LIMIT = 2000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const ORDER_EVENT_TYPES = new Set([
  "order.group_started",
  "order.member_joined",
  "order.created",
  "order.accepted",
  "order.deleted",
  "order.cancelled",
  "order.expired",
  "order.completed",
]);
const ROOM_TERMINATION_EVENTS = new Set(["order.deleted", "order.cancelled", "order.expired", "order.completed"]);

class InvalidOrderEventError extends Error {}

interface RoomSnapshot {
  requesterId: number;
  courierId: number | null;
  memberIds: number[];
}

interface StoredMessage {
  id: string;
  orderId: string;
  senderId: number;
  body: string;
  sentAt: Date;
}

const roomSubscriptions = new Map<string, Subscription>();
const startingRooms = new Map<string, Promise<void>>();
let pubsubClient: PubSub | undefined;

function getPubSub(): PubSub {
  pubsubClient ??= new PubSub({ projectId: config.pubsub.projectId });
  return pubsubClient;
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 6;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 5;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function participantIds(value: unknown): RoomSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const { requesterId, courierId } = value;
  const memberIds = value.memberIds ?? [];
  if (
    typeof requesterId !== "number" || !Number.isSafeInteger(requesterId) || requesterId <= 0 ||
    (courierId !== null && (typeof courierId !== "number" || !Number.isSafeInteger(courierId) || courierId <= 0)) ||
    !Array.isArray(memberIds) ||
    !memberIds.every((id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0)
  ) return undefined;
  return { requesterId, courierId, memberIds: [...new Set([requesterId, ...memberIds, ...(courierId === null ? [] : [courierId])])] };
}

function roomTopic(orderId: string): string {
  return `${config.pubsub.chatTopicPrefix}${orderId}`;
}

function roomSubscription(orderId: string): string {
  return `${config.pubsub.chatSubscriptionPrefix}${orderId}`;
}

async function ensureRoomSubscription(
  pubsub: PubSub,
  orderId: string,
  receive: (message: StoredMessage) => Promise<void>,
): Promise<void> {
  if (roomSubscriptions.has(orderId)) return;
  const starting = startingRooms.get(orderId);
  if (starting) return starting;

  const task = (async () => {
    const topicName = roomTopic(orderId);
    const topic = pubsub.topic(topicName, { messageOrdering: true });
    await pubsub.createTopic(topicName).catch((error: unknown) => {
      if (!isAlreadyExists(error)) throw error;
    });
    await topic.createSubscription(roomSubscription(orderId), {
      enableMessageOrdering: true,
    }).catch((error: unknown) => {
      if (!isAlreadyExists(error)) throw error;
    });

    const subscription = pubsub.subscription(roomSubscription(orderId));
    roomSubscriptions.set(orderId, subscription);
    subscription.on("message", (message) => {
      let payload: unknown;
      try {
        payload = JSON.parse(message.data.toString("utf8"));
      } catch (error) {
        console.error(`[chat-service] Dropped unreadable message for order ${orderId}`, error);
        message.ack();
        return;
      }

      void receiveChatMessage(payload, orderId, receive)
        .then(() => message.ack())
        .catch((error: unknown) => {
          console.error(`[chat-service] Could not store message for order ${orderId}`, error);
          message.nack();
        });
    });
    subscription.on("error", (error) => console.error(`[chat-service] Subscription error for order ${orderId}`, error));
  })();
  startingRooms.set(orderId, task);
  try {
    await task;
  } finally {
    startingRooms.delete(orderId);
  }
}

async function receiveChatMessage(
  payload: unknown,
  expectedOrderId: string,
  receive: (message: StoredMessage) => Promise<void>,
): Promise<void> {
  if (
    !isRecord(payload) ||
    payload.type !== "chat.message" ||
    !isUuid(payload.id) ||
    payload.orderId !== expectedOrderId ||
    typeof payload.senderId !== "number" ||
    !Number.isSafeInteger(payload.senderId) ||
    payload.senderId <= 0 ||
    typeof payload.body !== "string" ||
    payload.body.trim().length === 0 ||
    payload.body.length > MESSAGE_BODY_LIMIT ||
    typeof payload.sentAt !== "string" ||
    !Number.isFinite(Date.parse(payload.sentAt))
  ) {
    console.error(`[chat-service] Dropped invalid chat message for order ${expectedOrderId}`);
    return;
  }

  const [room] = await db.select().from(chatRooms).where(eq(chatRooms.orderId, expectedOrderId));
  if (!room || room.expiresAt) {
    console.error(`[chat-service] Dropped message from a nonparticipant for order ${expectedOrderId}`);
    return;
  }
  const members = await db.select({ userId: chatRoomMembers.userId }).from(chatRoomMembers)
    .where(eq(chatRoomMembers.orderId, expectedOrderId));
  if (!canAccessChat({ ...room, memberIds: members.map(({ userId }) => userId) }, payload.senderId)) {
    console.error(`[chat-service] Dropped message from a nonparticipant for order ${expectedOrderId}`);
    return;
  }
  await receive({
    id: payload.id,
    orderId: expectedOrderId,
    senderId: payload.senderId,
    body: payload.body,
    sentAt: new Date(payload.sentAt),
  });
}

async function deleteRoomResources(pubsub: PubSub, orderId: string): Promise<void> {
  const subscription = roomSubscriptions.get(orderId) ?? pubsub.subscription(roomSubscription(orderId));
  roomSubscriptions.delete(orderId);
  await subscription.close();
  await subscription.delete().catch((error: unknown) => {
    if (!isNotFound(error)) throw error;
  });
  await pubsub.topic(roomTopic(orderId)).delete().catch((error: unknown) => {
    if (!isNotFound(error)) throw error;
  });
}

async function handleOrderEvent(pubsub: PubSub, event: unknown, receive: (message: StoredMessage) => Promise<void>): Promise<void> {
  if (!isRecord(event) || typeof event.type !== "string" || !ORDER_EVENT_TYPES.has(event.type) || !isUuid(event.orderId)) {
    throw new InvalidOrderEventError("Invalid order lifecycle event");
  }

  if (ROOM_TERMINATION_EVENTS.has(event.type)) {
    const occurredAt = typeof event.occurredAt === "string" && Number.isFinite(Date.parse(event.occurredAt))
      ? new Date(event.occurredAt)
      : new Date();
    await db.update(chatRooms)
      .set({ expiresAt: chatExpiresAt(occurredAt) })
      .where(and(eq(chatRooms.orderId, event.orderId), isNull(chatRooms.expiresAt)));
    return;
  }

  const snapshot = isRecord(event.order) ? event.order : undefined;
  const participants = participantIds(snapshot);
  if (!participants) throw new InvalidOrderEventError(`Invalid participants in ${event.type} event`);

  if (
    event.type === "order.group_started" ||
    event.type === "order.member_joined" ||
    event.type === "order.created" ||
    event.type === "order.accepted"
  ) {
    await db.insert(chatRooms).values({ orderId: event.orderId, ...participants })
      .onConflictDoUpdate({
        target: chatRooms.orderId,
        set: { requesterId: participants.requesterId, courierId: participants.courierId },
      });
    await db.insert(chatRoomMembers).values(
      participants.memberIds.map((userId) => ({ orderId: event.orderId as string, userId })),
    ).onConflictDoNothing();
    await ensureRoomSubscription(pubsub, event.orderId, receive);
  }
}

function eventHandler(
  pubsub: PubSub,
  receive: (message: StoredMessage) => Promise<void>,
  name: string,
  subscription: Subscription,
): void {
  subscription.on("message", (message: Message) => {
    let event: unknown;
    try {
      event = JSON.parse(message.data.toString("utf8"));
    } catch (error) {
      console.error(`[chat-service] Dropped unreadable ${name} event`, error);
      message.ack();
      return;
    }
    void handleOrderEvent(pubsub, event, receive)
      .then(() => message.ack())
      .catch((error: unknown) => {
        if (error instanceof InvalidOrderEventError) {
          console.error(`[chat-service] Dropped invalid ${name} event: ${error.message}`);
          message.ack();
          return;
        }
        console.error(`[chat-service] Could not process ${name} event`, error);
        message.nack();
      });
  });
  subscription.on("error", (error) => console.error(`[chat-service] ${name} subscription error`, error));
}

async function ensureGlobalSubscription(pubsub: PubSub): Promise<Subscription> {
  const topic = pubsub.topic(config.pubsub.orderEventsTopic);
  if (config.pubsub.emulatorHost) {
    await pubsub.createTopic(config.pubsub.orderEventsTopic).catch((error: unknown) => {
      if (!isAlreadyExists(error)) throw error;
    });
  }

  await topic.createSubscription(config.pubsub.orderEventsSubscription, {
    filter: ORDER_EVENTS_FILTER,
    enableMessageOrdering: true,
  }).catch((error: unknown) => {
    if (!isAlreadyExists(error)) throw error;
  });
  return pubsub.subscription(config.pubsub.orderEventsSubscription);
}

async function storeChatMessage(message: StoredMessage): Promise<void> {
  await db.insert(chatMessages).values(message).onConflictDoNothing();
}

async function deleteExpiredRooms(pubsub: PubSub): Promise<void> {
  const expired = await db.select({ orderId: chatRooms.orderId }).from(chatRooms)
    .where(lte(chatRooms.expiresAt, new Date()));
  for (const { orderId } of expired) {
    await deleteRoomResources(pubsub, orderId);
    await db.delete(chatRooms).where(eq(chatRooms.orderId, orderId));
  }
}

export async function publishChatMessage(
  orderId: string,
  senderId: number,
  body: string,
): Promise<StoredMessage> {
  await ensureRoomSubscription(getPubSub(), orderId, storeChatMessage);
  const message: StoredMessage = { id: randomUUID(), orderId, senderId, body, sentAt: new Date() };
  await getPubSub().topic(roomTopic(orderId), { messageOrdering: true })
    .publishMessage({
      json: { ...message, type: "chat.message", sentAt: message.sentAt.toISOString() },
      orderingKey: orderId,
      attributes: { type: "chat.message", orderId },
    });
  return message;
}

export async function startEventSubscriptions() {
  const pubsub = getPubSub();
  let global: Subscription | undefined;
  try {
    await deleteExpiredRooms(pubsub);
    global = await ensureGlobalSubscription(pubsub);
    eventHandler(pubsub, storeChatMessage, "order-events", global);
    const rooms = await db.select({ orderId: chatRooms.orderId }).from(chatRooms);
    await Promise.all(rooms.map(({ orderId }) => ensureRoomSubscription(pubsub, orderId, storeChatMessage)));
  } catch (error) {
    if (global) await global.close();
    await pubsub.close();
    pubsubClient = undefined;
    throw error;
  }

  let cleanupRunning = false;
  const cleanupTimer = setInterval(() => {
    if (cleanupRunning) return;
    cleanupRunning = true;
    void deleteExpiredRooms(pubsub)
      .catch((error: unknown) => console.error("[chat-service] Expired chatroom cleanup failed", error))
      .finally(() => { cleanupRunning = false; });
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  return {
    stop: async () => {
      clearInterval(cleanupTimer);
      await Promise.allSettled([...roomSubscriptions.values()].map((subscription) => subscription.close()));
      roomSubscriptions.clear();
      await global.close();
      await pubsub.close();
      pubsubClient = undefined;
    },
  };
}

export function isValidOrderId(value: string): boolean {
  return isUuid(value);
}
