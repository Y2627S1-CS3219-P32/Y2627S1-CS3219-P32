/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Order reads joined with the supplier version each order points to, with
 * filtering, +/- sorting, and keyset (cursor) pagination.
 * Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-17: title, requester and courier display names,
 * several states per filter, and the order's event history. Author review: Pending.
 */
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/index.js";
import { orderEvents, orders, supplierVersions, users } from "../db/schema.js";
import { encodeCursor, type ListQuery } from "./input.js";

const requesters = alias(users, "requesters");
const couriers = alias(users, "couriers");
const actors = alias(users, "actors");

function selectOrders() {
  return db
    .select({
      order: orders,
      // Exact text keeps microseconds, so the cursor matches the stored value.
      createdAtText: sql<string>`${orders.createdAt}::text`,
      requesterName: requesters.displayName,
      courierName: couriers.displayName,
      supplier: {
        name: supplierVersions.name,
        type: supplierVersions.type,
        buildingName: supplierVersions.buildingName,
        floor: supplierVersions.floor,
        locationDescription: supplierVersions.locationDescription,
        latitude: supplierVersions.latitude,
        longitude: supplierVersions.longitude,
      },
    })
    .from(orders)
    .innerJoin(supplierVersions, and(
      eq(orders.supplierId, supplierVersions.supplierId),
      eq(orders.supplierVersion, supplierVersions.version),
    ))
    .innerJoin(requesters, eq(orders.requesterId, requesters.id))
    .leftJoin(couriers, eq(orders.courierId, couriers.id));
}

type Row = Awaited<ReturnType<ReturnType<typeof selectOrders>["execute"]>>[number];

function toResponse({ order, supplier, requesterName, courierName }: Row) {
  return {
    id: order.id,
    // Display names are null for users deleted before their creation event arrived.
    requester: { id: order.requesterId, displayName: requesterName },
    courier: order.courierId === null ? null : { id: order.courierId, displayName: courierName },
    // The supplier as it was when the order was created.
    supplier: { id: order.supplierId, version: order.supplierVersion, ...supplier },
    title: order.title,
    description: order.description,
    deliveryLocation: order.deliveryLocation,
    creditReward: order.creditReward,
    state: order.currentState,
    acceptedAt: order.acceptedAt,
    expiresAt: order.expiresAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export type OrderResponse = ReturnType<typeof toResponse>;

export async function getOrder(id: string): Promise<OrderResponse | undefined> {
  const [row] = await selectOrders().where(eq(orders.id, id));
  return row ? toResponse(row) : undefined;
}

// The order's log, oldest first, with who caused each change (null for the system).
export async function listOrderEvents(orderId: string) {
  const rows = await db
    .select({
      id: orderEvents.id,
      sequence: orderEvents.sequence,
      type: orderEvents.type,
      state: orderEvents.state,
      actorId: orderEvents.actorId,
      actorName: actors.displayName,
      createdAt: orderEvents.createdAt,
    })
    .from(orderEvents)
    .leftJoin(actors, eq(orderEvents.actorId, actors.id))
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(asc(orderEvents.sequence));

  return rows.map(({ actorId, actorName, ...event }) => ({
    ...event,
    actor: actorId === null ? null : { id: actorId, displayName: actorName },
  }));
}

export async function listOrders(query: ListQuery, requesterId?: number) {
  const descending = query.sort.startsWith("-");
  const byReward = query.sort.endsWith("reward");
  const column = byReward ? orders.creditReward : orders.createdAt;

  let after: SQL | undefined;
  if (query.cursor) {
    const value = byReward ? sql`${query.cursor.value}::integer` : sql`${query.cursor.value}::timestamptz`;
    after = descending
      ? sql`(${column}, ${orders.id}) < (${value}, ${query.cursor.id}::uuid)`
      : sql`(${column}, ${orders.id}) > (${value}, ${query.cursor.id}::uuid)`;
  }

  const direction = descending ? desc : asc;
  // One extra row tells us whether there is a next page.
  const rows = await selectOrders()
    .where(and(
      query.states.length > 0 ? inArray(orders.currentState, query.states) : undefined,
      query.supplierId ? eq(orders.supplierId, query.supplierId) : undefined,
      requesterId !== undefined ? eq(orders.requesterId, requesterId) : undefined,
      after,
    ))
    .orderBy(direction(column), direction(orders.id))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const nextCursor = rows.length > query.limit && last
    ? encodeCursor({
      sort: query.sort,
      value: byReward ? last.order.creditReward : last.createdAtText,
      id: last.order.id,
    })
    : null;

  return { items: page.map(toResponse), nextCursor };
}
