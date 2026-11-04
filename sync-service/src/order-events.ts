/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Order events that shape documents: order.group_started creates and seeds one
 * with the starting description, order.member_joined adds a member, and order.cancelled
 * or order.created close it. Idempotent, so redeliveries change nothing.
 * Author review: Pending.
 */
import { and, eq } from "drizzle-orm";
import * as Y from "yjs";
import { db } from "./db/index.js";
import { documentMembers, documents, documentUpdates, type DocumentStatus } from "./db/schema.js";
import { TEXT_NAME } from "./documents.js";

export const ORDER_EVENTS_FILTER = [
  "order.group_started",
  "order.member_joined",
  "order.created",
  "order.cancelled",
].map((type) => `attributes.type = "${type}"`).join(" OR ");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

// Returns the document's new status when the event closed it, so every instance can be told.
export async function applyOrderEvent(event: unknown): Promise<DocumentStatus | undefined> {
  if (typeof event !== "object" || event === null) return undefined;
  const { type, orderId, order } = event as Record<string, unknown>;
  if (typeof orderId !== "string" || !UUID.test(orderId) || typeof order !== "object" || order === null) return undefined;
  // order.member_joined carries the new member in the order payload.
  const { isGroupOrder, requesterId, description, member } = order as Record<string, unknown>;
  if (isGroupOrder !== true) return undefined;
  const id = orderId.toLowerCase();

  if (type === "order.group_started") {
    const requester = positiveInteger(requesterId);
    if (!requester) return undefined;
    await db.transaction(async (tx) => {
      const created = await tx.insert(documents).values({ orderId: id, requesterId: requester, status: "open" })
        .onConflictDoNothing().returning({ orderId: documents.orderId });
      if (created.length === 0) return;
      // Seeded once, in the same transaction, with the description given at creation.
      const doc = new Y.Doc();
      doc.getText(TEXT_NAME).insert(0, typeof description === "string" ? description : "");
      await tx.insert(documentUpdates).values({ orderId: id, update: Y.encodeStateAsUpdate(doc) });
      doc.destroy();
    });
    return undefined;
  }

  if (type === "order.member_joined") {
    const userId = positiveInteger(typeof member === "object" && member !== null ? (member as Record<string, unknown>).id : undefined);
    if (userId) await db.insert(documentMembers).values({ orderId: id, userId }).onConflictDoNothing();
    return undefined;
  }

  const status: DocumentStatus | undefined = type === "order.cancelled" ? "cancelled" : type === "order.created" ? "placed" : undefined;
  if (!status) return undefined;
  const closed = await db.update(documents).set({ status })
    .where(and(eq(documents.orderId, id), eq(documents.status, "open")))
    .returning({ orderId: documents.orderId });
  return closed.length > 0 ? status : undefined;
}
