/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: The single order write path (append an order_events row and update the
 * cached state in one transaction), order creation, the student-defined state
 * transitions for user actions and saga commands, and the expiry sweep.
 * Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-17: title, and editing an OPEN order (order.edited).
 * Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-17: group orders (start in SYNCHRONISING, members join,
 * placed by the sync service), member ids in snapshots, transitions from several states,
 * and cancelling before acceptance. Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-18: wait for the publish before returning. Author review: Pending.
 */
import { and, asc, desc, eq, lte } from "drizzle-orm";
import { config } from "../config.js";
import { db, type Transaction } from "../db/index.js";
import { orderEvents, orderMembers, orders, supplierVersions, users, type OrderState } from "../db/schema.js";
import { HttpError } from "../errors.js";
import { requestOutboxPublish } from "../events/outbox.js";
import type { OrderEdit, OrderInput } from "./input.js";

type Order = typeof orders.$inferSelect;
type OrderUpdates = Partial<Pick<Order, "courierId" | "acceptedAt" | "expiresAt" | "title" | "description" | "deliveryLocation">>;

interface Transition {
  from: readonly OrderState[];
  to: OrderState;
  type: string;
}

// The order as carried in every event payload (event-carried state transfer). memberIds
// lists everyone in a group order, requester first; it is empty for normal orders.
function snapshot(order: Order, memberIds: number[]) {
  return {
    id: order.id,
    requesterId: order.requesterId,
    courierId: order.courierId,
    supplierId: order.supplierId,
    supplierVersion: order.supplierVersion,
    title: order.title,
    description: order.description,
    deliveryLocation: order.deliveryLocation,
    creditReward: order.creditReward,
    isGroupOrder: order.isGroupOrder,
    memberIds,
    state: order.currentState,
    acceptedAt: order.acceptedAt?.toISOString() ?? null,
    expiresAt: order.expiresAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
  };
}

const allows = (transition: Transition, state: OrderState) => transition.from.includes(state);

async function memberIdsOf(tx: Transaction, order: Order): Promise<number[]> {
  if (!order.isGroupOrder) return [];
  const members = await tx.select({ userId: orderMembers.userId }).from(orderMembers)
    .where(eq(orderMembers.orderId, order.id)).orderBy(asc(orderMembers.joinedAt), asc(orderMembers.userId));
  return [order.requesterId, ...members.map((member) => member.userId)];
}

async function lockOrder(tx: Transaction, id: string): Promise<Order | undefined> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");
  return order;
}

// Every state change goes through here, with the order row already locked.
async function appendEvent(
  tx: Transaction,
  order: Order,
  transition: Transition,
  options: { actorId: number | null; commandId?: string; updates?: OrderUpdates; extra?: Record<string, unknown> },
): Promise<Order> {
  const [last] = await tx.select({ sequence: orderEvents.sequence }).from(orderEvents)
    .where(eq(orderEvents.orderId, order.id)).orderBy(desc(orderEvents.sequence)).limit(1);

  const [updated] = await tx.update(orders)
    .set({ ...options.updates, currentState: transition.to })
    .where(eq(orders.id, order.id))
    .returning();
  if (!updated) throw new Error("Locked order could not be updated");

  await tx.insert(orderEvents).values({
    orderId: order.id,
    sequence: (last?.sequence ?? 0) + 1,
    type: transition.type,
    state: transition.to,
    actorId: options.actorId,
    commandId: options.commandId ?? null,
    payload: { ...snapshot(updated, await memberIdsOf(tx, updated)), ...options.extra },
  });
  return updated;
}

// FR10.1: the order starts PENDING and records order.created, which starts the
// credit reservation saga. A group order starts SYNCHRONISING (order.group_started) while
// members edit the description together; order.created follows when it is placed.
export async function createOrder(requesterId: number, input: OrderInput): Promise<string> {
  const id = await db.transaction(async (tx) => {
    // The latest version is the supplier as it is now; the order keeps pointing at it.
    const [supplier] = await tx.select().from(supplierVersions)
      .where(eq(supplierVersions.supplierId, input.supplierId))
      .orderBy(desc(supplierVersions.version)).limit(1);
    if (!supplier || supplier.deleted) throw new HttpError(400, "Supplier not found");
    if (!supplier.isActive) throw new HttpError(400, "Supplier is not active"); // FR10.1.1

    const [order] = await tx.insert(orders).values({
      requesterId,
      supplierId: supplier.supplierId,
      supplierVersion: supplier.version,
      title: input.title,
      description: input.description,
      deliveryLocation: input.deliveryLocation,
      creditReward: input.creditReward,
      isGroupOrder: input.isGroupOrder,
      currentState: input.isGroupOrder ? "SYNCHRONISING" : "PENDING",
    }).returning();
    if (!order) throw new Error("Order insert returned no row");

    await tx.insert(orderEvents).values({
      orderId: order.id,
      sequence: 1,
      type: input.isGroupOrder ? "order.group_started" : "order.created",
      state: order.currentState,
      actorId: requesterId,
      payload: snapshot(order, input.isGroupOrder ? [requesterId] : []),
    });
    return order.id;
  });
  await requestOutboxPublish();
  return id;
}

export const USER_ACTIONS = {
  accept: { from: ["OPEN"], to: "ACCEPTED", type: "order.accepted" },
  cancel: { from: ["SYNCHRONISING", "PENDING", "OPEN"], to: "CANCELLED", type: "order.cancelled" },
  pickup: { from: ["ACCEPTED"], to: "PICKED_UP", type: "order.picked_up" },
  deliver: { from: ["PICKED_UP"], to: "DELIVERED", type: "order.delivered" },
  confirm: { from: ["DELIVERED"], to: "COMPLETE", type: "order.completed" },
} as const satisfies Record<string, Transition>;

export type UserAction = keyof typeof USER_ACTIONS;

const PAST_TENSE: Record<UserAction, string> = {
  accept: "accepted",
  cancel: "cancelled",
  pickup: "picked up",
  deliver: "delivered",
  confirm: "confirmed",
};

// Who may perform each action. Returns an error message when the caller may not.
function forbiddenReason(action: UserAction, order: Order, userId: number): string | undefined {
  switch (action) {
    case "accept":
      return order.requesterId === userId ? "You cannot accept your own request" : undefined; // FR11.2.1
    case "cancel":
    case "confirm":
      return order.requesterId === userId ? undefined : "Only the requester can do this";
    case "pickup":
    case "deliver":
      return order.courierId === userId ? undefined : "Only the assigned courier can do this";
  }
}

export async function performUserAction(action: UserAction, orderId: string, userId: number): Promise<void> {
  const transition = USER_ACTIONS[action];
  await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!order) throw new HttpError(404, "Order not found");

    const reason = forbiddenReason(action, order, userId);
    if (reason) throw new HttpError(403, reason);
    // Group members are part of the request too, so they cannot accept it either.
    if (action === "accept" && order.isGroupOrder && (await memberIdsOf(tx, order)).includes(userId)) {
      throw new HttpError(403, "You cannot accept a group order you are part of");
    }

    // An OPEN order past its expiry time cannot be accepted, even if the sweep has not run yet.
    const overdue = action === "accept" && order.expiresAt !== null && order.expiresAt.getTime() <= Date.now();
    if (!allows(transition, order.currentState) || overdue) {
      throw new HttpError(409, `Order cannot be ${PAST_TENSE[action]} while ${overdue ? "EXPIRED" : order.currentState}`);
    }

    const updates: OrderUpdates = action === "accept" ? { courierId: userId, acceptedAt: new Date() } : {};
    await appendEvent(tx, order, transition, { actorId: userId, updates });
  });
  await requestOutboxPublish();
}

const EDIT = { from: ["OPEN"], to: "OPEN", type: "order.edited" } as const satisfies Transition;

// The requester may change the text fields while the order is OPEN. The reward is
// fixed because the credit saga has already reserved it.
export async function editOrder(orderId: string, userId: number, edit: OrderEdit): Promise<void> {
  await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!order) throw new HttpError(404, "Order not found");
    if (order.requesterId !== userId) throw new HttpError(403, "Only the requester can do this");
    if (!allows(EDIT, order.currentState)) throw new HttpError(409, `Order cannot be edited while ${order.currentState}`);
    await appendEvent(tx, order, EDIT, { actorId: userId, updates: edit });
  });
  await requestOutboxPublish();
}

const JOIN = { from: ["SYNCHRONISING"], to: "SYNCHRONISING", type: "order.member_joined" } as const satisfies Transition;

// Joining a group order through its link. Joining again (or the requester joining) is a no-op.
export async function joinOrder(orderId: string, userId: number): Promise<void> {
  const joined = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!order) throw new HttpError(404, "Order not found");
    if (!order.isGroupOrder) throw new HttpError(409, "This is not a group order");
    if (order.requesterId === userId) return false;
    const [existing] = await tx.select().from(orderMembers)
      .where(and(eq(orderMembers.orderId, orderId), eq(orderMembers.userId, userId)));
    if (existing) return false;
    if (!allows(JOIN, order.currentState)) throw new HttpError(409, "This group order has already been placed");

    await tx.insert(orderMembers).values({ orderId, userId });
    const [member] = await tx.select({ displayName: users.displayName }).from(users).where(eq(users.id, userId));
    await appendEvent(tx, order, JOIN, {
      actorId: userId,
      extra: { member: { id: userId, displayName: member?.displayName ?? null } },
    });
    return true;
  });
  if (joined) await requestOutboxPublish();
}

const PLACE = { from: ["SYNCHRONISING"], to: "PENDING", type: "order.created" } as const satisfies Transition;

// group.placed from the sync service: stores the agreed description and starts the saga
// with order.created. Redeliveries (same event id) and placed or cancelled orders are ignored.
export async function placeGroupOrder(placed: { eventId: string; orderId: string; description: string; placedBy: number }): Promise<CommandResult> {
  const result = await db.transaction(async (tx): Promise<CommandResult> => {
    const order = await lockOrder(tx, placed.orderId);
    if (!order || !order.isGroupOrder) return "ignored";
    const [seen] = await tx.select({ id: orderEvents.id }).from(orderEvents).where(eq(orderEvents.commandId, placed.eventId));
    if (seen) return "duplicate";
    if (!allows(PLACE, order.currentState)) return "ignored";
    await appendEvent(tx, order, PLACE, {
      actorId: placed.placedBy,
      commandId: placed.eventId,
      updates: { description: placed.description },
    });
    return "applied";
  });
  if (result === "applied") await requestOutboxPublish();
  return result;
}

export const SAGA_COMMANDS = {
  OpenOrder: { from: ["PENDING"], to: "OPEN", type: "order.opened" },
  RejectOrder: { from: ["PENDING"], to: "REJECTED", type: "order.rejected" },
  AbortOrder: { from: ["PENDING"], to: "ABORTED", type: "order.aborted" },
  SettleOrder: { from: ["COMPLETE"], to: "SETTLED", type: "order.settled" },
} as const satisfies Record<string, Transition>;

export type SagaCommandType = keyof typeof SAGA_COMMANDS;

export type CommandResult = "applied" | "duplicate" | "ignored";

// Idempotent: a redelivered command (same commandId), or one that no longer applies
// to the order's state, changes nothing and is acknowledged.
export async function handleSagaCommand(command: { commandId: string; type: SagaCommandType; orderId: string }): Promise<CommandResult> {
  const transition = SAGA_COMMANDS[command.type];
  const result = await db.transaction(async (tx): Promise<CommandResult> => {
    const order = await lockOrder(tx, command.orderId);
    if (!order) return "ignored";

    const [seen] = await tx.select({ id: orderEvents.id }).from(orderEvents)
      .where(eq(orderEvents.commandId, command.commandId));
    if (seen) return "duplicate";
    if (!allows(transition, order.currentState)) return "ignored";

    const updates: OrderUpdates = command.type === "OpenOrder"
      ? { expiresAt: new Date(Date.now() + config.openOrderTtlSeconds * 1000) }
      : {};
    await appendEvent(tx, order, transition, { actorId: null, commandId: command.commandId, updates });
    return "applied";
  });
  if (result === "applied") await requestOutboxPublish();
  return result;
}

const EXPIRE = { from: ["OPEN"], to: "EXPIRED", type: "order.expired" } as const satisfies Transition;
const EXPIRY_BATCH = 100;

// FR13.2: moves overdue OPEN orders to EXPIRED. SKIP LOCKED leaves orders that an
// accept or cancel is changing right now, and lets overlapping sweeps split the work.
export async function expireOverdueOrders(now = new Date()): Promise<number> {
  let total = 0;
  for (;;) {
    const count = await db.transaction(async (tx) => {
      const overdue = await tx.select().from(orders)
        .where(and(eq(orders.currentState, "OPEN"), lte(orders.expiresAt, now)))
        .orderBy(asc(orders.expiresAt))
        .limit(EXPIRY_BATCH)
        .for("update", { skipLocked: true });
      for (const order of overdue) await appendEvent(tx, order, EXPIRE, { actorId: null });
      return overdue.length;
    });
    total += count;
    if (count < EXPIRY_BATCH) break;
  }
  if (total > 0) await requestOutboxPublish();
  return total;
}
