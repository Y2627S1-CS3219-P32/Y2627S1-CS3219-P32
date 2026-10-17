/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Integration tests for the sync service with real y-websocket clients: document
 * creation from order events, access checks, concurrent editing, storage and compaction,
 * relayed updates, placing, and cancelling. Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-17: relayed presence. Author review: Pending.
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import WebSocket from "ws";
import { WebsocketProvider } from "y-websocket";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("Set TEST_DATABASE_URL to a PostgreSQL connection with permission to create a disposable test database.");
}

const JWT_SECRET = randomBytes(32).toString("hex");
process.env.JWT_SECRET = JWT_SECRET;
process.env.SYNC_TICKET_SECRET = randomBytes(32).toString("hex");
delete process.env.ALLOWED_ORIGINS;
delete process.env.PUBSUB_EMULATOR_HOST;

const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
const databaseName = `sync_test_${randomBytes(8).toString("hex")}`;
let createdDatabase = false;
let server, baseUrl, wsBase, pool, applyOrderEvent, applyRelayedUpdate, applyRelayedAwareness, loadDocument;
const relayed = [];
const syncEvents = [];
const providers = [];

const REQUESTER = 1;
const MEMBER = 2;
const OUTSIDER = 3;

function jwt(userId) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const content = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: String(userId), iat: now, exp: now + 900 })}`;
  return `${content}.${createHmac("sha256", JWT_SECRET).update(content).digest("base64url")}`;
}

async function ticket(userId) {
  const response = await fetch(`${baseUrl}/tickets`, { method: "POST", headers: { authorization: `Bearer ${jwt(userId)}` } });
  assert.equal(response.status, 201);
  return (await response.json()).ticket;
}

function orderEvent(type, orderId, extra = {}) {
  return {
    eventId: randomUUID(),
    type,
    orderId,
    order: { id: orderId, requesterId: REQUESTER, isGroupOrder: true, description: "Coffee run", ...extra.order },
    ...extra.event,
  };
}

async function groupOrder(description = "Coffee run") {
  const orderId = randomUUID();
  await applyOrderEvent(orderEvent("order.group_started", orderId, { order: { description } }));
  await applyOrderEvent(orderEvent("order.member_joined", orderId, { order: { member: { id: MEMBER, displayName: "Member" } } }));
  return orderId;
}

// Resolves with the HTTP status that refused the connection.
async function refusedStatus(orderId, userId) {
  const socket = new WebSocket(`${wsBase}/${orderId}?ticket=${encodeURIComponent(await ticket(userId))}`);
  const [, response] = await once(socket, "unexpected-response");
  return response.statusCode;
}

async function client(orderId, userId) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(wsBase, orderId, doc, {
    WebSocketPolyfill: WebSocket,
    params: { ticket: await ticket(userId) },
    disableBc: true,
    connect: true,
  });
  providers.push(provider);
  const closes = [];
  provider.on("connection-close", (event) => {
    closes.push(event?.code);
    provider.shouldConnect = false; // tickets are single use; don't retry in tests
  });
  if (!provider.synced) await new Promise((resolve) => provider.once("sync", (synced) => synced && resolve()));
  return { doc, text: doc.getText("description"), provider, closes };
}

const until = async (check, what) => {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${what}`);
};

before(async () => {
  await admin.connect();
  await admin.query(`create database "${databaseName}"`);
  createdDatabase = true;
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  process.env.DATABASE_URL = url.href;

  const dbModule = await import("../dist/db/index.js");
  pool = dbModule.pool;
  await migrate(dbModule.db, { migrationsFolder: "./drizzle" });

  (await import("../dist/pubsub.js")).setPublisher({
    relay: async (orderId, attributes, data) => { relayed.push({ orderId, attributes, data }); },
    syncEvent: async (event, orderingKey) => { syncEvents.push({ event, orderingKey }); },
  });
  ({ applyOrderEvent } = await import("../dist/order-events.js"));
  ({ applyRelayedUpdate, applyRelayedAwareness, loadDocument } = await import("../dist/documents.js"));

  const { createSyncServer } = await import("../dist/server.js");
  ({ server } = createSyncServer());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  wsBase = `ws://127.0.0.1:${server.address().port}/documents`;
});

after(async () => {
  for (const provider of providers) provider.destroy();
  server.closeAllConnections?.();
  server.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await pool?.end();
  if (createdDatabase) await admin.query(`drop database "${databaseName}" with (force)`);
  await admin.end();
  setImmediate(() => process.exit(0)); // eviction timers would otherwise keep the run alive
});

test("documents start from order.group_started with the given description, once", async () => {
  const orderId = randomUUID();
  const started = orderEvent("order.group_started", orderId, { order: { description: "Two lattes" } });
  await applyOrderEvent(started);
  await applyOrderEvent(started); // redelivery: not seeded twice
  const doc = await loadDocument(orderId);
  assert.equal(doc.getText("description").toString(), "Two lattes");

  // Normal orders and unrelated events are ignored.
  assert.equal(await applyOrderEvent(orderEvent("order.group_started", randomUUID(), { order: { isGroupOrder: false } })), undefined);
  assert.equal(await applyOrderEvent({ nonsense: true }), undefined);
});

test("only the requester and members of an open group order can connect", async () => {
  const orderId = await groupOrder();
  assert.equal(await refusedStatus(orderId, OUTSIDER), 403);
  assert.equal(await refusedStatus(randomUUID(), REQUESTER), 404);

  const noTicket = new WebSocket(`${wsBase}/${orderId}`);
  assert.equal((await once(noTicket, "unexpected-response"))[1].statusCode, 401);

  const requester = await client(orderId, REQUESTER);
  const member = await client(orderId, MEMBER);
  assert.equal(requester.text.toString(), "Coffee run");
  assert.equal(member.text.toString(), "Coffee run");
});

test("concurrent edits converge, and every update is stored and relayed", async () => {
  const orderId = await groupOrder("Coffee");
  const requester = await client(orderId, REQUESTER);
  const member = await client(orderId, MEMBER);

  requester.text.insert(0, "Two ");
  member.text.insert(member.text.length, " please");
  await until(() => requester.text.toString() === member.text.toString() && requester.text.toString().length === "Two Coffee please".length, "convergence");
  assert.equal(requester.text.toString(), "Two Coffee please");

  await until(async () => (await loadDocument(orderId)).getText("description").toString() === "Two Coffee please", "storage");
  assert.ok(relayed.filter((item) => item.orderId === orderId && item.attributes.kind === "update").length >= 2);
});

test("updates relayed from another instance reach this instance's clients", async () => {
  const orderId = await groupOrder("Tea");
  const member = await client(orderId, MEMBER);

  // Another instance's client typed this; it was stored and relayed there.
  const elsewhere = await loadDocument(orderId);
  const before = Y.encodeStateVector(elsewhere);
  elsewhere.getText("description").insert(3, " x2");
  await applyRelayedUpdate(orderId, Y.encodeStateAsUpdate(elsewhere, before));
  await until(() => member.text.toString() === "Tea x2", "relayed update");
});

test("documents with many updates are compacted when loaded", async () => {
  const orderId = await groupOrder("");
  const requester = await client(orderId, REQUESTER);
  for (let i = 0; i < 60; i++) requester.text.insert(requester.text.length, "a");
  const count = async () => Number((await pool.query("select count(*) from document_updates where order_id = $1", [orderId])).rows[0].count);
  await until(async () => (await count()) >= 61, "stored updates");
  const loaded = await loadDocument(orderId);
  assert.equal(loaded.getText("description").toString(), "a".repeat(60));
  assert.equal(await count(), 1);
  assert.equal((await loadDocument(orderId)).getText("description").toString(), "a".repeat(60));
});

test("the requester places the order: text checked, group.placed published, editing closed", async () => {
  const orderId = await groupOrder("");
  const place = (userId) => fetch(`${baseUrl}/documents/${orderId}/place`, { method: "POST", headers: { authorization: `Bearer ${jwt(userId)}` } });
  const requester = await client(orderId, REQUESTER);
  const member = await client(orderId, MEMBER);

  assert.equal((await place(MEMBER)).status, 403);
  assert.equal((await place(REQUESTER)).status, 400); // empty
  member.text.insert(0, "x".repeat(501));
  await until(async () => (await loadDocument(orderId)).getText("description").length === 501, "long text stored");
  assert.equal((await place(REQUESTER)).status, 400);

  member.text.delete(0, 501);
  member.text.insert(0, "  Two lattes, one less sweet  ");
  await until(async () => (await loadDocument(orderId)).getText("description").toString().includes("lattes"), "text stored");
  const placed = await place(REQUESTER);
  assert.equal(placed.status, 202);
  assert.deepEqual(await placed.json(), { status: "placed", description: "Two lattes, one less sweet" });

  const [published] = syncEvents.filter((item) => item.event.orderId === orderId);
  assert.equal(published.event.type, "group.placed");
  assert.equal(published.event.description, "Two lattes, one less sweet");
  assert.equal(published.event.placedBy, REQUESTER);
  assert.equal(published.orderingKey, orderId);
  assert.ok(relayed.some((item) => item.orderId === orderId && item.attributes.status === "placed"));

  await until(() => requester.closes.includes(4003) && member.closes.includes(4003), "clients closed");
  assert.equal((await place(REQUESTER)).status, 409);
  assert.equal(await refusedStatus(orderId, MEMBER), 409);
  assert.equal((await fetch(`${baseUrl}/documents/${randomUUID()}/place`, { method: "POST", headers: { authorization: `Bearer ${jwt(1)}` } })).status, 404);
  assert.equal((await fetch(`${baseUrl}/documents/${orderId}/place`, { method: "POST" })).status, 401);
});

test("order.cancelled closes the document", async () => {
  const orderId = await groupOrder();
  const member = await client(orderId, MEMBER);
  assert.equal(await applyOrderEvent(orderEvent("order.cancelled", orderId)), "cancelled");
  assert.equal(await applyOrderEvent(orderEvent("order.cancelled", orderId)), undefined); // already closed
  // The subscription handler tells this instance; here we do it directly.
  (await import("../dist/documents.js")).applyStatus(orderId, "cancelled");
  await until(() => member.closes.includes(4004), "client closed");
  assert.equal(await refusedStatus(orderId, REQUESTER), 409);
});

test("presence is relayed between instances, including when someone leaves", async () => {
  const orderId = await groupOrder("Presence");
  const requester = await client(orderId, REQUESTER);
  const member = await client(orderId, MEMBER);

  // A local client's cursor and name go out to the other instances.
  member.provider.awareness.setLocalStateField("user", { name: "Member" });
  await until(() => relayed.some((item) => item.orderId === orderId && item.attributes.kind === "awareness"), "relayed presence");

  // Someone on another instance: their presence reaches this instance's clients.
  const remoteDoc = new Y.Doc();
  const remote = new awarenessProtocol.Awareness(remoteDoc);
  remote.setLocalStateField("user", { name: "Remote" });
  applyRelayedAwareness(orderId, awarenessProtocol.encodeAwarenessUpdate(remote, [remoteDoc.clientID]));
  const names = () => [...requester.provider.awareness.getStates().values()].map((state) => state.user?.name).filter(Boolean);
  await until(() => names().includes("Remote") && names().includes("Member"), "remote presence");

  // When the member disconnects, the removal is relayed too.
  const before = relayed.length;
  member.provider.disconnect();
  await until(() => relayed.slice(before).some((item) => item.orderId === orderId && item.attributes.kind === "awareness"), "relayed removal");
  await until(() => !names().includes("Member"), "member gone");
  remote.destroy();
});
