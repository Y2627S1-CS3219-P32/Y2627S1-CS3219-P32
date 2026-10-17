/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Order reads joined with the supplier version each order points to, with
 * filtering, +/- sorting, and keyset (cursor) pagination.
 * Author review: Pending.
 */
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import { orders, supplierVersions } from "../db/schema.js";
import { encodeCursor, type ListQuery } from "./input.js";

function selectOrders() {
  return db
    .select({
      order: orders,
      // Exact text keeps microseconds, so the cursor matches the stored value.
      createdAtText: sql<string>`${orders.createdAt}::text`,
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
    ));
}

type Row = Awaited<ReturnType<ReturnType<typeof selectOrders>["execute"]>>[number];

function toResponse({ order, supplier }: Row) {
  return {
    id: order.id,
    requesterId: order.requesterId,
    courierId: order.courierId,
    // The supplier as it was when the order was created.
    supplier: { id: order.supplierId, version: order.supplierVersion, ...supplier },
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
      query.state ? eq(orders.currentState, query.state) : undefined,
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
