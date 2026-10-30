/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Placing a group order: the requester locks the document, and its final text is
 * published as group.placed for the order service. Author review: Pending.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { documents } from "./db/schema.js";
import { applyStatus, flushWrites, loadDocument, TEXT_NAME } from "./documents.js";
import { publish } from "./pubsub.js";

export class PlaceError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

export async function placeDocument(orderId: string, userId: number): Promise<string> {
  const [document] = await db.select().from(documents).where(eq(documents.orderId, orderId));
  if (!document) throw new PlaceError(404, "Group order not found");
  if (document.requesterId !== userId) throw new PlaceError(403, "Only the requester can place the order");
  if (document.status !== "open") throw new PlaceError(409, `This group order is already ${document.status}`);

  // Every stored update is in the database; this instance's own may still be in flight.
  await flushWrites(orderId);
  const doc = await loadDocument(orderId);
  const description = doc.getText(TEXT_NAME).toString().trim();
  doc.destroy();
  if (!description) throw new PlaceError(400, "The description is empty");
  if (description.length > config.maxDescription) {
    throw new PlaceError(400, `The description must be at most ${config.maxDescription} characters`);
  }

  const locked = await db.update(documents).set({ status: "placed" })
    .where(and(eq(documents.orderId, orderId), eq(documents.status, "open")))
    .returning({ orderId: documents.orderId });
  if (locked.length === 0) throw new PlaceError(409, "This group order is no longer open");

  try {
    await publish.syncEvent({
      eventId: randomUUID(),
      type: "group.placed",
      orderId,
      description,
      placedBy: userId,
      occurredAt: new Date().toISOString(),
    }, orderId);
  } catch (error) {
    await db.update(documents).set({ status: "open" }).where(eq(documents.orderId, orderId));
    console.error(`[sync-service] Could not publish group.placed for ${orderId}`, error);
    throw new PlaceError(502, "The order could not be placed. Please try again.");
  }

  applyStatus(orderId, "placed");
  await publish.relay(orderId, { kind: "status", status: "placed" }, new Uint8Array())
    .catch((error: unknown) => console.error(`[sync-service] Could not relay status for ${orderId}`, error));
  return description;
}
