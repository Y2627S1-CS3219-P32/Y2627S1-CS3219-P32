/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Tests for ticket issuing and redemption, WebSocket authentication, origin
 * checks, session expiry, and routing order events to the right users' sockets.
 * Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-17: notification rules, storage, the notifications
 * API, and live notification pushes. Author review: Pending.
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { WebSocket } from "ws";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("Set TEST_DATABASE_URL to a PostgreSQL connection with permission to create a disposable test database.");
}

const JWT_SECRET = randomBytes(32).toString("hex");
const ORIGIN = "http://frontend.test";
process.env.JWT_SECRET = JWT_SECRET;
process.env.NOTIFICATION_TICKET_SECRET = randomBytes(32).toString("hex");
process.env.ALLOWED_ORIGINS = ORIGIN;

let server, baseUrl, wsUrl, routeOrderEvent, notificationsForOrderEvent, storeNotifications, db, pool;
const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
const databaseName = `notification_test_${randomBytes(8).toString("hex")}`;
let createdDatabase = false;

// Same format as user-service createAccessToken.
function jwt(userId, { expiresIn = 900, secret = JWT_SECRET } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const content = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: String(userId), iat: now, exp: now + expiresIn })}`;
  return `${content}.${createHmac("sha256", secret).update(content).digest("base64url")}`;
}

async function ticketFor(userId, options) {
  const response = await fetch(`${baseUrl}/tickets`, { method: "POST", headers: { authorization: `Bearer ${jwt(userId, options)}` } });
  assert.equal(response.status, 201);
  return (await response.json()).ticket;
}

// Resolves with the open socket and a queue of its messages, or rejects with the HTTP status.
function connect(ticket, { origin = ORIGIN } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${wsUrl}?ticket=${encodeURIComponent(ticket)}`, { origin });
    const messages = [];
    const waiters = [];
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else messages.push(message);
    });
    const next = () => messages.length > 0
      ? Promise.resolve(messages.shift())
      : new Promise((done) => waiters.push(done));
    socket.on("unexpected-response", (_request, response) => reject(new Error(String(response.statusCode))));
    socket.on("error", reject);
    socket.on("open", async () => {
      assert.deepEqual(await next(), { type: "ready" });
      resolve({ socket, next, pending: () => messages.length });
    });
  });
}

before(async () => {
  await admin.connect();
  await admin.query(`create database "${databaseName}"`);
  createdDatabase = true;
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  process.env.DATABASE_URL = url.href;
  ({ db, pool } = await import("../dist/db/index.js"));
  await migrate(db, { migrationsFolder: "./drizzle" });
  ({ notificationsForOrderEvent } = await import("../dist/rules.js"));
  ({ storeNotifications } = await import("../dist/store.js"));

  const { createNotificationServer } = await import("../dist/server.js");
  ({ routeOrderEvent } = await import("../dist/order-events.js"));
  ({ server } = createNotificationServer());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  wsUrl = `ws://127.0.0.1:${server.address().port}/ws`;
});

after(async () => {
  server.closeAllConnections?.();
  server.close();
  await pool?.end();
  if (createdDatabase) await admin.query(`drop database "${databaseName}" with (force)`);
  await admin.end();
});

test("POST /tickets needs a valid user JWT", async () => {
  const noToken = await fetch(`${baseUrl}/tickets`, { method: "POST" });
  assert.equal(noToken.status, 401);
  for (const token of [jwt(1, { secret: "x".repeat(40) }), jwt(1, { expiresIn: -1 }), "not-a-jwt"]) {
    const response = await fetch(`${baseUrl}/tickets`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 401);
  }
  const ok = await fetch(`${baseUrl}/tickets`, { method: "POST", headers: { authorization: `Bearer ${jwt(1)}` } });
  assert.equal(ok.status, 201);
  const body = await ok.json();
  assert.equal(typeof body.ticket, "string");
  assert.equal(body.expiresIn, 30);
});

test("a WebSocket needs a valid, unused ticket and an allowed origin", async () => {
  await assert.rejects(connect(""), /401/);
  await assert.rejects(connect("garbage.ticket"), /401/);

  const ticket = await ticketFor(1);
  const [payload, signature] = ticket.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url")), u: 2 })).toString("base64url");
  await assert.rejects(connect(`${forged}.${signature}`), /401/);

  await assert.rejects(connect(ticket, { origin: "http://evil.test" }), /403/);

  const { socket } = await connect(ticket);
  socket.close();
  await assert.rejects(connect(ticket), /401/); // single use

  const wrongPath = new WebSocket(wsUrl.replace("/ws", "/other"), { origin: ORIGIN });
  const [, response] = await once(wrongPath, "unexpected-response");
  assert.equal(response.statusCode, 404);
});

test("order events reach the requester's and courier's sockets only", async () => {
  const requesterTab1 = await connect(await ticketFor(10));
  const requesterTab2 = await connect(await ticketFor(10));
  const courier = await connect(await ticketFor(20));
  const bystander = await connect(await ticketFor(30));

  const event = {
    eventId: "e1",
    type: "order.accepted",
    orderId: "o1",
    sequence: 3,
    state: "ACCEPTED",
    order: { id: "o1", requesterId: 10, courierId: 20, title: "Coffee" },
  };
  assert.deepEqual(routeOrderEvent(event).sort(), [10, 20]);
  for (const client of [requesterTab1, requesterTab2, courier]) {
    assert.deepEqual(await client.next(), { type: "order.event", event });
  }
  assert.equal(bystander.pending(), 0);

  // Before acceptance there is no courier; offline users are skipped.
  assert.deepEqual(routeOrderEvent({ ...event, order: { ...event.order, courierId: null } }), [10]);
  assert.deepEqual(routeOrderEvent({ ...event, order: { requesterId: 99, courierId: null } }), []);
  assert.deepEqual(routeOrderEvent({ nonsense: true }), []);

  requesterTab2.socket.close();
  await once(requesterTab2.socket, "close");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(routeOrderEvent(event).sort(), [10, 20]);
  await requesterTab1.next();
  await courier.next();

  for (const client of [requesterTab1, courier, bystander]) client.socket.close();
});

test("the socket closes when the user's session expires", async () => {
  const { socket } = await connect(await ticketFor(40, { expiresIn: 2 }));
  const [code, reason] = await once(socket, "close");
  assert.equal(code, 4001);
  assert.equal(reason.toString(), "Session expired");
});

function orderEvent(type, { actorId = null, requesterId = 10, courierId = 20, occurredAt = new Date().toISOString(), eventId = randomUUID() } = {}) {
  return {
    eventId,
    type,
    orderId: "6f1c2e0a-8a43-4c1e-9d6f-2b7f9e1a4c55",
    sequence: 2,
    state: "X",
    actorId,
    occurredAt,
    order: { id: "6f1c2e0a-8a43-4c1e-9d6f-2b7f9e1a4c55", requesterId, courierId, title: "Coffee", creditReward: 5 },
  };
}

test("rules: requesters hear about progress, couriers about payment, nobody about their own action", () => {
  const recipients = (type, options) => notificationsForOrderEvent(orderEvent(type, options)).map((n) => n.userId);
  assert.deepEqual(recipients("order.opened"), [10]);
  assert.deepEqual(recipients("order.accepted", { actorId: 20 }), [10]);
  assert.deepEqual(recipients("order.delivered", { actorId: 20 }), [10]);
  assert.deepEqual(recipients("order.expired"), [10]);
  assert.deepEqual(recipients("order.completed", { actorId: 10 }), [20]);
  assert.deepEqual(recipients("order.settled"), [20]);
  assert.deepEqual(recipients("order.created", { actorId: 10, courierId: null }), []);
  assert.deepEqual(recipients("order.edited", { actorId: 10, courierId: null }), []);
  assert.deepEqual(recipients("order.cancelled", { actorId: 10, courierId: null }), []);
  // A requester acting on their own order is not told about it.
  assert.deepEqual(recipients("order.accepted", { actorId: 10 }), []);
  assert.deepEqual(notificationsForOrderEvent({ type: "order.opened" }), []);

  const event = orderEvent("order.accepted", { actorId: 20 });
  const [first] = notificationsForOrderEvent(event);
  const [again] = notificationsForOrderEvent(event);
  assert.equal(first.id, again.id);
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(first.payload, { title: "Coffee", creditReward: 5 });
  assert.equal(first.source, "order");
});

async function api(path, userId, init = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${jwt(userId)}`, "content-type": "application/json", ...init.headers },
  });
}

test("stored notifications: idempotent storage, paging, unread count and marking read", async () => {
  const user = 501;
  const base = Date.parse("2026-10-01T00:00:00Z");
  const events = Array.from({ length: 5 }, (_, i) =>
    orderEvent("order.opened", { requesterId: user, occurredAt: new Date(base + i * 1000).toISOString() }));
  for (const event of events) await storeNotifications(notificationsForOrderEvent(event));
  await storeNotifications(notificationsForOrderEvent(events[0])); // redelivery
  await storeNotifications(notificationsForOrderEvent(orderEvent("order.opened", { requesterId: 502 })));

  assert.equal((await fetch(`${baseUrl}/notifications`)).status, 401);

  const seen = [];
  let cursor;
  do {
    const response = await api(`/notifications?limit=2${cursor ? `&cursor=${cursor}` : ""}`, user);
    assert.equal(response.status, 200);
    const page = await response.json();
    seen.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.length, 5);
  assert.deepEqual(seen.map((n) => n.createdAt), events.map((e) => new Date(e.occurredAt).toISOString()).reverse());
  assert.ok(seen.every((n) => n.read === false && n.type === "order.opened" && n.source === "order"));

  const count = async () => (await (await api("/notifications/unread-count", user)).json()).count;
  assert.equal(await count(), 5);

  const one = await api("/notifications/read", user, { method: "POST", body: JSON.stringify({ ids: [seen[0].id] }) });
  assert.deepEqual(await one.json(), { updated: 1 });
  assert.equal(await count(), 4);

  // Another user's notification cannot be marked by this user.
  const [other] = (await (await api("/notifications", 502)).json()).items;
  assert.deepEqual(await (await api("/notifications/read", user, { method: "POST", body: JSON.stringify({ ids: [other.id] }) })).json(), { updated: 0 });

  const all = await api("/notifications/read", user, { method: "POST", body: "{}" });
  assert.deepEqual(await all.json(), { updated: 4 });
  assert.equal(await count(), 0);
  assert.equal(await (await api("/notifications/unread-count", 502)).json().then((b) => b.count), 1);

  for (const [path, init] of [
    ["/notifications?limit=0", {}],
    ["/notifications?cursor=garbage", {}],
    ["/notifications/read", { method: "POST", body: JSON.stringify({ ids: ["nope"] }) }],
    ["/notifications/read", { method: "POST", body: JSON.stringify({ ids: [] }) }],
  ]) {
    assert.equal((await api(path, user, init)).status, 400, path);
  }
});

test("live: the requester gets a notification push when a courier accepts", async () => {
  const requester = await connect(await ticketFor(601));
  const courier = await connect(await ticketFor(602));
  const event = orderEvent("order.accepted", { actorId: 602, requesterId: 601, courierId: 602 });
  routeOrderEvent(event);

  assert.equal((await requester.next()).type, "order.event");
  const pushed = await requester.next();
  assert.equal(pushed.type, "notification");
  assert.equal(pushed.notification.id, notificationsForOrderEvent(event)[0].id);
  assert.equal(pushed.notification.userId, 601);

  assert.equal((await courier.next()).type, "order.event");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(courier.pending(), 0); // no notification for their own action

  requester.socket.close();
  courier.socket.close();
});
