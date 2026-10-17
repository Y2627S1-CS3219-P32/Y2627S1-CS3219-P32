/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Collaborative group-order descriptions as Yjs documents. Each instance keeps the
 * documents its clients have open, speaks the y-websocket sync and awareness protocol,
 * stores every client update, and relays it to the other instances. Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-17: presence (cursors, names) relayed between instances
 * too, without being stored. Author review: Pending.
 */
import { and, asc, eq, lte } from "drizzle-orm";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { WebSocket } from "ws";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { db } from "./db/index.js";
import { documents, documentUpdates, type DocumentStatus } from "./db/schema.js";
import { publish } from "./pubsub.js";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
// Merged into one row when a document with more updates than this is loaded.
const COMPACT_AFTER = 50;
// Documents stay in memory this long after their last client leaves.
const EVICT_AFTER_MS = 30_000;

export const TEXT_NAME = "description";

// Origin used when a client of this instance disconnects, so its presence removal is relayed.
const DISCONNECTED = "disconnected";

// Close codes the frontend understands.
export const CLOSE_PLACED = 4003;
export const CLOSE_CANCELLED = 4004;

interface Room {
  orderId: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  // Each connection and the awareness client ids it controls.
  conns: Map<WebSocket, Set<number>>;
  status: DocumentStatus;
  ready: Promise<void>;
  // Stores (then relays) this room's client updates in order.
  writes: Promise<void>;
  evictTimer?: ReturnType<typeof setTimeout>;
}

const rooms = new Map<string, Room>();

function send(conn: WebSocket, message: Uint8Array): void {
  if (conn.readyState === WebSocket.OPEN) conn.send(message);
}

function syncUpdateMessage(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

function awarenessMessage(awareness: awarenessProtocol.Awareness, clients: number[]): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, clients));
  return encoding.toUint8Array(encoder);
}

// Builds a document from its stored updates, merging them into one row when there are many.
export async function loadDocument(orderId: string, doc = new Y.Doc()): Promise<Y.Doc> {
  const rows = await db.select({ id: documentUpdates.id, update: documentUpdates.update })
    .from(documentUpdates).where(eq(documentUpdates.orderId, orderId)).orderBy(asc(documentUpdates.id));
  if (rows.length === 0) return doc;
  const merged = Y.mergeUpdates(rows.map((row) => row.update));
  Y.applyUpdate(doc, merged, "db");

  if (rows.length > COMPACT_AFTER) {
    const lastId = rows.at(-1)!.id;
    await db.transaction(async (tx) => {
      await tx.delete(documentUpdates).where(and(eq(documentUpdates.orderId, orderId), lte(documentUpdates.id, lastId)));
      await tx.insert(documentUpdates).values({ orderId, update: merged });
    });
  }
  return doc;
}

function createRoom(orderId: string): Room {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);
  const room: Room = { orderId, doc, awareness, conns: new Map(), status: "open", ready: Promise.resolve(), writes: Promise.resolve() };

  doc.on("update", (update: Uint8Array, origin: unknown) => {
    const message = syncUpdateMessage(update);
    for (const conn of room.conns.keys()) if (conn !== origin) send(conn, message);
    // Only updates from this instance's clients are stored and relayed; relayed and
    // stored updates already were.
    if (origin instanceof WebSocket) {
      room.writes = room.writes
        .then(() => db.insert(documentUpdates).values({ orderId, update }))
        .then(() => publish.relay(orderId, { kind: "update" }, update))
        .catch((error: unknown) => console.error(`[sync-service] Could not store or relay an update for ${orderId}`, error));
    }
  });

  awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    const changed = [...added, ...updated, ...removed];
    if (origin instanceof WebSocket) {
      const controlled = room.conns.get(origin);
      if (controlled) {
        for (const id of added) controlled.add(id);
        for (const id of removed) controlled.delete(id);
      }
    }
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness, changed);
    const message = awarenessMessage(awareness, changed);
    for (const conn of room.conns.keys()) send(conn, message);
    // Presence from this instance's clients goes to the other instances (not stored).
    if (origin instanceof WebSocket || origin === DISCONNECTED) {
      publish.relay(orderId, { kind: "awareness" }, update)
        .catch((error: unknown) => console.error(`[sync-service] Could not relay presence for ${orderId}`, error));
    }
  });

  room.ready = (async () => {
    const [row] = await db.select({ status: documents.status }).from(documents).where(eq(documents.orderId, orderId));
    if (row) room.status = row.status;
    await loadDocument(orderId, doc);
  })();
  return room;
}

async function getRoom(orderId: string): Promise<Room> {
  let room = rooms.get(orderId);
  if (!room) rooms.set(orderId, room = createRoom(orderId));
  clearTimeout(room.evictTimer);
  try {
    await room.ready;
  } catch (error) {
    rooms.delete(orderId);
    throw error;
  }
  return room;
}

function closeCodeFor(status: DocumentStatus): [number, string] {
  return status === "placed" ? [CLOSE_PLACED, "Order placed"] : [CLOSE_CANCELLED, "Order cancelled"];
}

// Serves one client of a document over the y-websocket protocol.
export function attachConnection(conn: WebSocket, orderId: string): void {
  // Messages are handled in order once the document has loaded.
  let queue: Promise<unknown> = getRoom(orderId).then((room) => {
    if (room.status !== "open") {
      conn.close(...closeCodeFor(room.status));
      return;
    }
    room.conns.set(conn, new Set());

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    send(conn, encoding.toUint8Array(encoder));
    const others = [...room.awareness.getStates().keys()];
    if (others.length > 0) send(conn, awarenessMessage(room.awareness, others));
  }).catch((error: unknown) => {
    console.error(`[sync-service] Could not open document ${orderId}`, error);
    conn.close(1011, "Document unavailable");
  });

  conn.on("message", (data: Buffer) => {
    queue = queue.then(async () => {
      const room = rooms.get(orderId);
      if (!room || !room.conns.has(conn)) return;
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const type = decoding.readVarUint(decoder);
      if (type === MESSAGE_SYNC) {
        if (room.status !== "open") return;
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, reply, room.doc, conn);
        if (encoding.length(reply) > 1) send(conn, encoding.toUint8Array(reply));
      } else if (type === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), conn);
      }
    }).catch((error: unknown) => {
      console.error(`[sync-service] Bad message for ${orderId}`, error);
      conn.close(1003, "Unsupported message");
    });
  });

  conn.once("close", () => {
    queue.finally(() => {
      const room = rooms.get(orderId);
      const controlled = room?.conns.get(conn);
      if (!room || !controlled) return;
      room.conns.delete(conn);
      awarenessProtocol.removeAwarenessStates(room.awareness, [...controlled], DISCONNECTED);
      if (room.conns.size === 0) {
        room.evictTimer = setTimeout(() => {
          if (room.conns.size > 0) return;
          rooms.delete(orderId);
          room.awareness.destroy();
          room.doc.destroy();
        }, EVICT_AFTER_MS);
      }
    });
  });
}

// An update another instance stored and relayed.
export async function applyRelayedUpdate(orderId: string, update: Uint8Array): Promise<void> {
  const room = rooms.get(orderId);
  if (!room) return; // not open here; the database already has it
  await room.ready;
  Y.applyUpdate(room.doc, update, "relay");
}

// Presence from another instance's clients. States from an instance that disappears expire
// on their own after 30 seconds without a refresh.
export function applyRelayedAwareness(orderId: string, update: Uint8Array): void {
  const room = rooms.get(orderId);
  if (room) awarenessProtocol.applyAwarenessUpdate(room.awareness, update, "relay");
}

// Placed or cancelled: this instance's clients are disconnected and editing stops.
export function applyStatus(orderId: string, status: DocumentStatus): void {
  const room = rooms.get(orderId);
  if (!room) return;
  room.status = status;
  if (status !== "open") for (const conn of room.conns.keys()) conn.close(...closeCodeFor(status));
}

// Waits for this instance's pending writes for a document, before reading it back.
export async function flushWrites(orderId: string): Promise<void> {
  await rooms.get(orderId)?.writes;
}

export function openRoomIds(): string[] {
  return [...rooms.keys()];
}

