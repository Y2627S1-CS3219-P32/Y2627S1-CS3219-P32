/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
 * Scope: Applying order-events (the full order snapshot in each event) and
 * supplier-events (latest version only) to this service's local copies. Parsing
 * helpers follow order-service/src/events/consumers.ts. Author review: Pending.
 * Claude Code (Opus 5.5), 2026-11-01. Scope: Orders are embedded again when their supplier,
 * or the supplier's name or type, changes. Author review: Pending.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { orders, suppliers } from "../db/schema.js";

export class InvalidMessageError extends Error {}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InvalidMessageError(`${what} must be an object`);
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new InvalidMessageError(`${what} must be a positive integer`);
  return value;
}

function nullablePositiveInteger(value: unknown, what: string): number | null {
  return value === null || value === undefined ? null : positiveInteger(value, what);
}

function uuid(value: unknown, what: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new InvalidMessageError(`${what} must be a UUID`);
  return value.toLowerCase();
}

function string(value: unknown, what: string): string {
  if (typeof value !== "string") throw new InvalidMessageError(`${what} must be a string`);
  return value;
}

function nullableString(value: unknown, what: string): string | null {
  return value === null || value === undefined ? null : string(value, what);
}

function date(value: unknown, what: string): Date {
  const parsed = new Date(string(value, what));
  if (Number.isNaN(parsed.getTime())) throw new InvalidMessageError(`${what} must be a date`);
  return parsed;
}

function nullableDate(value: unknown, what: string): Date | null {
  return value === null || value === undefined ? null : date(value, what);
}

function coordinate(value: unknown, what: string, limit: number): number {
  const parsed = Number(string(value, what));
  if (!Number.isFinite(parsed) || Math.abs(parsed) > limit) throw new InvalidMessageError(`${what} must be a coordinate`);
  return parsed;
}

// order-events: { eventId, type, orderId, sequence, state, order: { ...full order } }.
// Delivery is at least once and may be out of order, so only a newer sequence applies.
// Returns true when the order's text or supplier changed and it needs embedding.
export async function applyOrderEvent(message: unknown): Promise<boolean> {
  const event = record(message, "order event");
  const sequence = positiveInteger(event.sequence, "sequence");
  const order = record(event.order, "order");
  const values = {
    id: uuid(order.id, "order.id"),
    sequence,
    requesterId: positiveInteger(order.requesterId, "order.requesterId"),
    courierId: nullablePositiveInteger(order.courierId, "order.courierId"),
    supplierId: uuid(order.supplierId, "order.supplierId"),
    title: string(order.title, "order.title"),
    description: string(order.description, "order.description"),
    deliveryLocation: string(order.deliveryLocation, "order.deliveryLocation"),
    creditReward: positiveInteger(order.creditReward, "order.creditReward"),
    state: string(order.state, "order.state"),
    acceptedAt: nullableDate(order.acceptedAt, "order.acceptedAt"),
    expiresAt: nullableDate(order.expiresAt, "order.expiresAt"),
    createdAt: date(order.createdAt, "order.createdAt"),
  };
  if (values.id !== uuid(event.orderId, "orderId")) throw new InvalidMessageError("order.id must match orderId");

  // An edit that changes the text or the supplier drops the old embedding so the job
  // embeds it again (the supplier's name and type are part of the embedded text).
  const textUnchanged = sql`${orders.title} = excluded.title and ${orders.description} = excluded.description and ${orders.supplierId} = excluded.supplier_id`;
  const rows = await db.insert(orders).values(values)
    .onConflictDoUpdate({
      target: orders.id,
      set: {
        sequence: sql`excluded.sequence`,
        requesterId: sql`excluded.requester_id`,
        courierId: sql`excluded.courier_id`,
        supplierId: sql`excluded.supplier_id`,
        title: sql`excluded.title`,
        description: sql`excluded.description`,
        deliveryLocation: sql`excluded.delivery_location`,
        creditReward: sql`excluded.credit_reward`,
        state: sql`excluded.state`,
        acceptedAt: sql`excluded.accepted_at`,
        expiresAt: sql`excluded.expires_at`,
        embedding: sql`case when ${textUnchanged} then ${orders.embedding} else null end`,
        embeddingAttempts: sql`case when ${textUnchanged} then ${orders.embeddingAttempts} else 0 end`,
        embeddingError: sql`case when ${textUnchanged} then ${orders.embeddingError} else null end`,
        embeddingRetryAt: sql`case when ${textUnchanged} then ${orders.embeddingRetryAt} else null end`,
        embeddingInputVersion: sql`case when ${textUnchanged} then ${orders.embeddingInputVersion} else ${orders.embeddingInputVersion} + 1 end`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${orders.sequence} < excluded.sequence`,
    })
    .returning({ embedded: sql<boolean>`${orders.embedding} is not null` });
  return rows.length > 0 && !rows[0]!.embedded;
}

// supplier-events: only the latest version of each supplier is kept. Returns true when
// the supplier's name or type changed (or it is new), so its orders need embedding again.
export async function applySupplierEvent(message: unknown): Promise<boolean> {
  const event = record(message, "supplier event");
  const version = positiveInteger(event.version, "version");

  if (event.type === "supplier.deleted") {
    const id = uuid(event.supplierId, "supplierId");
    await db.insert(suppliers).values({ id, version, deleted: true })
      .onConflictDoUpdate({
        target: suppliers.id,
        set: { version, deleted: true },
        setWhere: sql`${suppliers.version} < ${version}`,
      });
    return false;
  }

  if (event.type !== "supplier.created" && event.type !== "supplier.updated") {
    throw new InvalidMessageError(`Unknown supplier event type: ${String(event.type)}`);
  }
  const supplier = record(event.supplier, "supplier");
  const values = {
    id: uuid(supplier.id, "supplier.id"),
    version,
    deleted: false,
    name: string(supplier.name, "supplier.name"),
    type: string(supplier.type, "supplier.type"),
    buildingName: nullableString(supplier.buildingName, "supplier.buildingName"),
    latitude: coordinate(supplier.latitude, "supplier.latitude", 90),
    longitude: coordinate(supplier.longitude, "supplier.longitude", 180),
  };
  return db.transaction(async (tx) => {
    const [before] = await tx.select({ name: suppliers.name, type: suppliers.type })
      .from(suppliers).where(eq(suppliers.id, values.id)).for("update");
    const applied = await tx.insert(suppliers).values(values)
      .onConflictDoUpdate({
        target: suppliers.id,
        set: {
          version,
          deleted: false,
          name: values.name,
          type: values.type,
          buildingName: values.buildingName,
          latitude: values.latitude,
          longitude: values.longitude,
        },
        setWhere: sql`${suppliers.version} < ${version}`,
      })
      .returning({ id: suppliers.id });
    if (applied.length === 0 || (before && before.name === values.name && before.type === values.type)) return false;

    // Orders may have been embedded before this supplier arrived, or under its old name.
    // Raising the version also stops an embedding of the old text that is still in flight.
    await tx.update(orders)
      .set({
        embedding: null,
        embeddingAttempts: 0,
        embeddingError: null,
        embeddingRetryAt: null,
        embeddingInputVersion: sql`${orders.embeddingInputVersion} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(orders.supplierId, values.id));
    return true;
  });
}
