/**AI Assistance Disclosure:
Tool: Claude Code (model: Opus 5.5), date: 2026-10-18
Scope: supplier-events contract (shape given by the student), outbox writes in the same
transaction as each change, and the relay that publishes unpublished rows to Pub/Sub in
version order (mirroring order-service/src/events/outbox.ts).
Author review: Pending. **/

import { PubSub, type Topic } from "@google-cloud/pubsub";
import { asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "./db/index.js";
import { buildings, operatingHours, supplierEvents, suppliers, types } from "./db/schema.js";

export interface SupplierSnapshot {
  id: string;
  name: string;
  type: string;
  buildingName: string | null;
  floor: string | null;
  locationDescription: string | null;
  latitude: string;
  longitude: string;
  isActive: boolean;
  imageUrl: string | null;
  operatingHours: { day: number; openingHrs: string; closingHrs: string }[];
}

export type SupplierEventPayload =
  | { type: "supplier.created" | "supplier.updated"; supplier: SupplierSnapshot }
  | { type: "supplier.deleted"; supplierId: string };

export type SupplierEvent = SupplierEventPayload & { eventId: string; version: number };

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// A supplier's operating hours as JSON, sorted by day and opening time. Times are
// "HH:MM" (closing may be "24:00"), matching the request format.
export function operatingHoursJson() {
  return sql<SupplierSnapshot["operatingHours"]>`(
    select coalesce(json_agg(json_build_object(
      'day', ${operatingHours.day},
      'openingHrs', to_char(${operatingHours.openingHrs}, 'HH24:MI'),
      'closingHrs', to_char(${operatingHours.closingHrs}, 'HH24:MI')
    ) order by ${operatingHours.day}, ${operatingHours.openingHrs}), '[]'::json)
    from ${operatingHours}
    where ${operatingHours.supplierId} = ${suppliers.id}
  )`;
}

function selectSnapshots(tx: Transaction, where: SQL): Promise<SupplierSnapshot[]> {
  return tx
    .select({
      id: suppliers.id,
      name: suppliers.name,
      type: types.name,
      buildingName: buildings.name,
      floor: suppliers.floor,
      locationDescription: suppliers.locationDescription,
      latitude: suppliers.latitude,
      longitude: suppliers.longitude,
      isActive: suppliers.isActive,
      imageUrl: suppliers.imageUrl,
      operatingHours: operatingHoursJson(),
    })
    .from(suppliers)
    .innerJoin(types, eq(suppliers.supplierTypeId, types.id))
    .leftJoin(buildings, eq(suppliers.buildingId, buildings.id))
    .where(where)
    .orderBy(asc(suppliers.id));
}

// Records the current state of every matching supplier, inside the transaction that
// changed it. Callers hold the suppliers' row locks, so each supplier's versions are
// assigned in commit order.
export async function recordSupplierChanges(
  tx: Transaction,
  type: "supplier.created" | "supplier.updated",
  where: SQL,
): Promise<void> {
  const snapshots = await selectSnapshots(tx, where);
  if (snapshots.length === 0) return;
  await tx.insert(supplierEvents).values(snapshots.map(snapshot => ({ type, supplierId: snapshot.id, payload: snapshot })));
}

export async function recordSupplierDeleted(tx: Transaction, supplierId: string): Promise<void> {
  await tx.insert(supplierEvents).values({ type: "supplier.deleted", supplierId, payload: null });
}

export type Publisher = (data: SupplierEvent, orderingKey: string, attributes: Record<string, string>) => Promise<void>;

const topicName = process.env.SUPPLIER_EVENTS_TOPIC ?? "supplier-events";
let topic: Topic | undefined;

const publishToPubSub: Publisher = async (data, orderingKey, attributes) => {
  topic ??= new PubSub({ projectId: process.env.PUBSUB_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? "foc-local" })
    .topic(topicName, { messageOrdering: true });
  try {
    await topic.publishMessage({ json: data, orderingKey, attributes });
  } catch (error) {
    // An ordering key pauses after a failure until resumed.
    topic.resumePublishing(orderingKey);
    throw error;
  }
};

let publisher: Publisher = publishToPubSub;

// Tests replace Pub/Sub with an in-memory publisher.
export function setPublisher(replacement: Publisher): void {
  publisher = replacement;
}

const BATCH = 100;

// Publishes at least once, in version order: a crash after publishing but before
// marking the row re-publishes it, so consumers dedupe by eventId or version.
export async function publishPendingSupplierEvents(): Promise<number> {
  return db.transaction(async (tx) => {
    // One relay at a time keeps each supplier's events in sequence.
    const { rows } = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(3219, 1) as locked`);
    if (!rows[0]?.locked) return 0;

    const pending = await tx.select().from(supplierEvents)
      .where(isNull(supplierEvents.publishedAt))
      .orderBy(asc(supplierEvents.version))
      .limit(BATCH);

    const published: string[] = [];
    const blocked = new Set<string>();
    for (const row of pending) {
      // After a failure, later events of the same supplier must wait for the next run.
      if (blocked.has(row.supplierId)) continue;
      const event: SupplierEvent = row.type === "supplier.deleted"
        ? { eventId: row.id, version: row.version, type: "supplier.deleted", supplierId: row.supplierId }
        : {
            eventId: row.id,
            version: row.version,
            type: row.type as "supplier.created" | "supplier.updated",
            supplier: row.payload as SupplierSnapshot,
          };
      try {
        await publisher(event, row.supplierId, { type: row.type, supplierId: row.supplierId });
        published.push(row.id);
      } catch (error) {
        console.error(`[supplier-service] Failed to publish supplier event ${row.id}`, error);
        blocked.add(row.supplierId);
      }
    }

    if (published.length > 0) {
      await tx.update(supplierEvents).set({ publishedAt: new Date() }).where(inArray(supplierEvents.id, published));
    }
    return published.length;
  });
}

let running: Promise<void> | undefined;
let rerun = false;

// Starts a relay run after a commit without delaying the response. A commit during
// a run triggers one more run. Anything still missed is picked up by the event
// worker's POST /outbox/publish (Cloud Scheduler, or the local ticker).
export function requestOutboxPublish(): void {
  if (running) {
    rerun = true;
    return;
  }
  running = (async () => {
    do {
      rerun = false;
      await publishPendingSupplierEvents();
    } while (rerun);
  })()
    .catch((error: unknown) => console.error("[supplier-service] Outbox relay failed", error))
    .finally(() => {
      running = undefined;
    });
}

// Lets tests wait for a relay started by a request.
export async function outboxIdle(): Promise<void> {
  while (running) await running;
}
