/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: HTTP and PostgreSQL integration tests for the order service: local JWT
 * checks, user/supplier event copies, order creation, state actions, saga
 * commands, expiry, the outbox, and listing with cursor pagination.
 * Author review: Pending.
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { after, before, beforeEach, test } from "node:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("Set TEST_DATABASE_URL to a PostgreSQL connection with permission to create a disposable test database.");
}

const JWT_SECRET = randomBytes(32).toString("hex");
const INTERNAL_SECRET = randomBytes(32).toString("hex");
const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
const databaseName = `order_routes_test_${randomBytes(8).toString("hex")}`;
let createdDatabase = false;
let db, pool, server, baseUrl, outbox;
const published = [];

// Same format as user-service createAccessToken.
function token(userId, { secret = JWT_SECRET, expiresIn = 900 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const content = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: String(userId), iat: now, exp: now + expiresIn })}`;
  return `${content}.${createHmac("sha256", secret).update(content).digest("base64url")}`;
}

function request(path, { user, method = "GET", body, headers = {} } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(user === undefined ? {} : { authorization: `Bearer ${token(user)}` }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function push(topic, message) {
  return request(`/internal/pubsub/${topic}`, {
    method: "POST",
    headers: { "x-internal-secret": INTERNAL_SECRET },
    body: { message: { data: Buffer.from(JSON.stringify(message)).toString("base64") } },
  });
}

let version = 1000;
const nextVersion = () => ++version;

function userEvent(id, overrides = {}) {
  return {
    type: "user.created",
    eventId: randomUUID(),
    version: nextVersion(),
    user: { id, name: `User ${id}`, displayName: `user-${id}`, email: `u${id}@u.nus.edu`, role: "student", passwordHash: "scrypt$x$y" },
    ...overrides,
  };
}

function supplierEvent(id, overrides = {}) {
  return {
    type: "supplier.created",
    eventId: randomUUID(),
    version: nextVersion(),
    supplier: {
      id,
      name: "Cool Spot",
      type: "Food/Coffee",
      buildingName: "COM2",
      floor: "B1",
      locationDescription: "Next to the lift",
      latitude: "1.294200",
      longitude: "103.773600",
      isActive: true,
      imageUrl: "https://example.com/cool.jpg",
      operatingHours: [{ day: 1, openingHrs: "08:00", closingHrs: "20:00" }],
      ...overrides.supplier,
    },
    ...(overrides.type ? { type: overrides.type } : {}),
  };
}

const REQUESTER = 1;
const COURIER = 2;
const OTHER = 3;
const supplierId = randomUUID();

async function command(type, orderId, commandId = randomUUID()) {
  const response = await push("order-commands", { commandId, type, orderId });
  assert.equal(response.status, 204);
  return commandId;
}

async function createOrder(overrides = {}, user = REQUESTER) {
  const response = await request("/orders", {
    user,
    method: "POST",
    body: { supplierId, description: "One iced latte", deliveryLocation: "COM1 level 2 lobby", creditReward: 5, ...overrides },
  });
  assert.equal(response.status, 201, await response.clone().text());
  return response.json();
}

async function openOrder(overrides) {
  const order = await createOrder(overrides);
  await command("OpenOrder", order.id);
  return order;
}

async function events(orderId) {
  const { rows } = await pool.query("select sequence, type, state, actor_id, command_id from order_events where order_id = $1 order by sequence", [orderId]);
  return rows;
}

before(async () => {
  await admin.connect();
  await admin.query(`create database "${databaseName}"`);
  createdDatabase = true;

  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  process.env.DATABASE_URL = url.href;
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.INTERNAL_SHARED_SECRET = INTERNAL_SECRET;
  delete process.env.PUBSUB_EMULATOR_HOST;

  ({ db, pool } = await import("../dist/db/index.js"));
  await migrate(db, { migrationsFolder: "./drizzle" });

  const pubsub = await import("../dist/events/pubsub.js");
  pubsub.setPublisher(async (topic, data, orderingKey) => {
    published.push({ topic, data, orderingKey });
  });
  outbox = await import("../dist/events/outbox.js");

  const { app } = await import("../dist/app.js");
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  for (const id of [REQUESTER, COURIER, OTHER]) assert.equal((await push("user-events", userEvent(id))).status, 204);
  assert.equal((await push("supplier-events", supplierEvent(supplierId))).status, 204);
});

beforeEach(async () => {
  await outbox.outboxIdle();
});

after(async () => {
  if (server) {
    server.close();
    await once(server, "close");
  }
  await outbox?.outboxIdle();
  await pool?.end();
  if (createdDatabase) await admin.query(`drop database "${databaseName}" with (force)`);
  await admin.end();
});

test("requires a valid token from a known, non-deleted user", async () => {
  assert.equal((await request("/orders")).status, 401);
  assert.equal((await request("/orders", { headers: { authorization: `Bearer ${token(REQUESTER, { secret: "x".repeat(40) })}` } })).status, 401);
  assert.equal((await request("/orders", { headers: { authorization: `Bearer ${token(REQUESTER, { expiresIn: -1 })}` } })).status, 401);

  const unsynced = await request("/orders", { user: 999 });
  assert.equal(unsynced.status, 503);
  assert.equal(unsynced.headers.get("retry-after"), "2");

  await push("user-events", userEvent(50));
  assert.equal((await request("/orders", { user: 50 })).status, 200);
  await push("user-events", { type: "user.deleted", eventId: randomUUID(), version: nextVersion(), userId: 50 });
  assert.equal((await request("/orders", { user: 50 })).status, 401);
});

test("user copy keeps id, display name and role, skips stale events, and soft deletes", async () => {
  await push("user-events", userEvent(60, { version: 5000 }));
  await push("user-events", { ...userEvent(60), type: "user.updated", version: 4000, user: { ...userEvent(60).user, displayName: "stale" } });
  let { rows } = await pool.query("select * from users where id = 60");
  assert.deepEqual(rows[0], { id: 60, display_name: "user-60", role: "student", version: "5000", deleted_at: null });

  // A deletion that arrives before the creation wins.
  await push("user-events", { type: "user.deleted", eventId: randomUUID(), version: 7001, userId: 61 });
  await push("user-events", userEvent(61, { version: 7000 }));
  ({ rows } = await pool.query("select display_name, deleted_at from users where id = 61"));
  assert.equal(rows[0].display_name, null);
  assert.ok(rows[0].deleted_at);
});

test("supplier copy appends versions, ignores redeliveries, and drops imageUrl", async () => {
  const id = randomUUID();
  const created = supplierEvent(id);
  await push("supplier-events", created);
  await push("supplier-events", created);
  await push("supplier-events", { ...supplierEvent(id, { supplier: { name: "Renamed" } }), type: "supplier.updated" });
  const { rows } = await pool.query("select version, name, deleted from supplier_versions where supplier_id = $1 order by version", [id]);
  assert.deepEqual(rows.map((row) => row.name), ["Cool Spot", "Renamed"]);
  const columns = await pool.query("select column_name from information_schema.columns where table_name = 'supplier_versions'");
  assert.ok(!columns.rows.some((row) => row.column_name.includes("image")));
});

test("malformed push messages are acknowledged without changes", async () => {
  const noData = await request("/internal/pubsub/user-events", { method: "POST", headers: { "x-internal-secret": INTERNAL_SECRET }, body: {} });
  assert.equal(noData.status, 204);
  assert.equal((await push("supplier-events", { type: "supplier.created", version: 1 })).status, 204);
});

test("internal routes reject callers without the internal secret or a Google token", async () => {
  assert.equal((await request("/internal/outbox/publish", { method: "POST" })).status, 401);
  assert.equal((await request("/internal/outbox/publish", { method: "POST", user: REQUESTER })).status, 401);
  const viaQuery = await request(`/internal/outbox/publish?token=${INTERNAL_SECRET}`, { method: "POST" });
  assert.equal(viaQuery.status, 200);
});

test("POST /orders validates the body and the supplier (FR10.1)", async () => {
  const cases = [
    [{ creditReward: 0 }, "creditReward must be a positive whole number"],
    [{ creditReward: 1.5 }, "creditReward must be a positive whole number"],
    [{ creditReward: "5" }, "creditReward must be a positive whole number"],
    [{ description: "  " }, "description is required"],
    [{ deliveryLocation: undefined }, "deliveryLocation is required"],
    [{ supplierId: "nope" }, "supplierId must be a supplier id"],
    [{ supplierId: randomUUID() }, "Supplier not found"],
  ];
  for (const [overrides, error] of cases) {
    const response = await request("/orders", {
      user: REQUESTER,
      method: "POST",
      body: { supplierId, description: "x", deliveryLocation: "y", creditReward: 5, ...overrides },
    });
    assert.equal(response.status, 400, JSON.stringify(overrides));
    assert.equal((await response.json()).error, error);
  }

  const inactive = randomUUID();
  await push("supplier-events", supplierEvent(inactive, { supplier: { isActive: false } }));
  let response = await request("/orders", { user: REQUESTER, method: "POST", body: { supplierId: inactive, description: "x", deliveryLocation: "y", creditReward: 1 } });
  assert.equal((await response.json()).error, "Supplier is not active");

  const deleted = randomUUID();
  await push("supplier-events", supplierEvent(deleted));
  await push("supplier-events", { type: "supplier.deleted", eventId: randomUUID(), version: nextVersion(), supplierId: deleted });
  response = await request("/orders", { user: REQUESTER, method: "POST", body: { supplierId: deleted, description: "x", deliveryLocation: "y", creditReward: 1 } });
  assert.equal((await response.json()).error, "Supplier not found");
});

test("POST /orders creates a PENDING order, records order.created, and publishes it", async () => {
  const order = await createOrder();
  assert.equal(order.state, "PENDING");
  assert.equal(order.requesterId, REQUESTER);
  assert.equal(order.courierId, null);
  assert.equal(order.supplier.id, supplierId);
  assert.equal(order.supplier.name, "Cool Spot");
  assert.equal(order.supplier.imageUrl, undefined);
  assert.deepEqual(await events(order.id), [{ sequence: 1, type: "order.created", state: "PENDING", actor_id: REQUESTER, command_id: null }]);

  await outbox.outboxIdle();
  const message = published.find((item) => item.data.orderId === order.id);
  assert.equal(message.topic, "order-events");
  assert.equal(message.orderingKey, order.id);
  assert.equal(message.data.type, "order.created");
  assert.equal(message.data.order.creditReward, 5);
  const { rows } = await pool.query("select published_at from order_events where order_id = $1", [order.id]);
  assert.ok(rows[0].published_at);
});

test("orders keep the supplier version they were created with", async () => {
  const id = randomUUID();
  await push("supplier-events", supplierEvent(id, { supplier: { name: "Before" } }));
  const order = await createOrder({ supplierId: id });
  await push("supplier-events", { ...supplierEvent(id, { supplier: { name: "After" } }), type: "supplier.updated" });

  const fetched = (await (await request("/orders/me", { user: REQUESTER })).json()).items.find((item) => item.id === order.id);
  assert.equal(fetched.supplier.name, "Before");
  assert.equal((await createOrder({ supplierId: id })).supplier.name, "After");
});

test("saga commands open, reject, abort and settle orders idempotently", async () => {
  const order = await createOrder();
  const commandId = await command("OpenOrder", order.id);
  await command("OpenOrder", order.id, commandId); // redelivery
  await command("OpenOrder", order.id); // new command, no longer PENDING
  await command("RejectOrder", order.id); // no longer PENDING
  const { rows } = await pool.query("select current_state, expires_at, created_at from orders where id = $1", [order.id]);
  assert.equal(rows[0].current_state, "OPEN");
  const ttl = rows[0].expires_at - Date.now();
  assert.ok(ttl > 2 * 60 * 60 * 1000 - 60_000 && ttl <= 2 * 60 * 60 * 1000, `expiry in ${ttl}ms`);
  assert.deepEqual((await events(order.id)).map((event) => [event.type, event.command_id]), [
    ["order.created", null],
    ["order.opened", commandId],
  ]);

  const rejected = await createOrder();
  await command("RejectOrder", rejected.id);
  const aborted = await createOrder();
  await command("AbortOrder", aborted.id);
  await command("SettleOrder", aborted.id); // not COMPLETE
  const states = await pool.query("select id, current_state from orders where id = any($1)", [[rejected.id, aborted.id]]);
  assert.deepEqual(Object.fromEntries(states.rows.map((row) => [row.id, row.current_state])), { [rejected.id]: "REJECTED", [aborted.id]: "ABORTED" });

  await command("OpenOrder", randomUUID()); // unknown order: acknowledged, nothing changes
});

test("the full errand flow runs from OPEN to SETTLED with the right people", async () => {
  const order = await openOrder();
  const act = (action, user) => request(`/orders/${order.id}/${action}`, { method: "POST", user });

  assert.equal((await act("accept", REQUESTER)).status, 403); // FR11.2.1
  assert.equal((await act("pickup", COURIER)).status, 403); // not yet the courier

  const accepted = await act("accept", COURIER);
  assert.equal(accepted.status, 200);
  const body = await accepted.json();
  assert.equal(body.state, "ACCEPTED");
  assert.equal(body.courierId, COURIER);
  assert.ok(body.acceptedAt);

  assert.equal((await act("accept", OTHER)).status, 409);
  assert.equal((await act("cancel", REQUESTER)).status, 409);
  assert.equal((await act("pickup", OTHER)).status, 403);
  assert.equal((await act("deliver", COURIER)).status, 409);
  assert.equal((await act("pickup", COURIER)).status, 200);
  assert.equal((await act("deliver", COURIER)).status, 200);
  assert.equal((await act("confirm", COURIER)).status, 403);
  const confirmed = await act("confirm", REQUESTER);
  assert.equal((await confirmed.json()).state, "COMPLETE");

  await command("SettleOrder", order.id);
  assert.deepEqual((await events(order.id)).map((event) => [event.sequence, event.type, event.state]), [
    [1, "order.created", "PENDING"],
    [2, "order.opened", "OPEN"],
    [3, "order.accepted", "ACCEPTED"],
    [4, "order.picked_up", "PICKED_UP"],
    [5, "order.delivered", "DELIVERED"],
    [6, "order.completed", "COMPLETE"],
    [7, "order.settled", "SETTLED"],
  ]);

  assert.equal((await request(`/orders/${randomUUID()}/accept`, { method: "POST", user: COURIER })).status, 404);
  assert.equal((await request("/orders/not-a-uuid/accept", { method: "POST", user: COURIER })).status, 404);
});

test("only the requester can cancel, and only while OPEN (FR13.1)", async () => {
  const pending = await createOrder();
  assert.equal((await request(`/orders/${pending.id}/cancel`, { method: "POST", user: REQUESTER })).status, 409);

  const order = await openOrder();
  assert.equal((await request(`/orders/${order.id}/cancel`, { method: "POST", user: COURIER })).status, 403);
  const cancelled = await request(`/orders/${order.id}/cancel`, { method: "POST", user: REQUESTER });
  assert.equal((await cancelled.json()).state, "CANCELLED");
});

test("two couriers accepting at once: exactly one wins", async () => {
  const order = await openOrder();
  const statuses = await Promise.all([COURIER, OTHER].map((user) => request(`/orders/${order.id}/accept`, { method: "POST", user }).then((r) => r.status)));
  assert.deepEqual(statuses.sort(), [200, 409]);
  assert.equal((await events(order.id)).length, 3);
});

test("the sweep expires overdue OPEN orders, and overdue orders cannot be accepted (FR13.2)", async () => {
  const overdue = await openOrder();
  const fresh = await openOrder();
  await pool.query("update orders set expires_at = now() - interval '1 second' where id = $1", [overdue.id]);

  assert.equal((await request(`/orders/${overdue.id}/accept`, { method: "POST", user: COURIER })).status, 409);

  const sweep = await request("/internal/orders/expire-overdue", { method: "POST", headers: { "x-internal-secret": INTERNAL_SECRET } });
  assert.ok((await sweep.json()).expired >= 1);
  const { rows } = await pool.query("select id, current_state from orders where id = any($1)", [[overdue.id, fresh.id]]);
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.id, row.current_state])), { [overdue.id]: "EXPIRED", [fresh.id]: "OPEN" });
  assert.deepEqual((await events(overdue.id)).at(-1), { sequence: 3, type: "order.expired", state: "EXPIRED", actor_id: null, command_id: null });
});

test("GET /orders filters by state and supplier, sorts by reward, and pages with a cursor (FR11.1)", async () => {
  const listSupplier = randomUUID();
  await push("supplier-events", supplierEvent(listSupplier));
  const rewards = [7, 3, 7, 10, 3, 7, 1];
  const created = [];
  for (const creditReward of rewards) created.push(await openOrder({ supplierId: listSupplier, creditReward }));
  await createOrder({ supplierId: listSupplier, creditReward: 50 }); // still PENDING

  async function all(sort, limit) {
    const ids = [];
    let cursor;
    do {
      const query = new URLSearchParams({ state: "OPEN", supplierId: listSupplier, sort, limit: String(limit), ...(cursor ? { cursor } : {}) });
      const response = await request(`/orders?${query}`, { user: COURIER });
      assert.equal(response.status, 200);
      const page = await response.json();
      assert.ok(page.items.length <= limit);
      ids.push(...page.items.map((item) => [item.creditReward, item.id]));
      cursor = page.nextCursor;
    } while (cursor);
    return ids;
  }

  const descending = await all("-reward", 2);
  assert.equal(descending.length, rewards.length);
  assert.deepEqual(descending.map(([reward]) => reward), [...rewards].sort((a, b) => b - a));
  assert.equal(new Set(descending.map(([, id]) => id)).size, rewards.length);

  const ascending = await all("reward", 3);
  assert.deepEqual(ascending.map(([reward]) => reward), [...rewards].sort((a, b) => a - b));

  const byTime = await all("createdAt", 2);
  assert.deepEqual(byTime.map(([, id]) => id), created.map((order) => order.id));
  const newestFirst = await all("-createdAt", 4);
  assert.deepEqual(newestFirst.map(([, id]) => id), created.map((order) => order.id).reverse());

  const first = await (await request(`/orders?supplierId=${listSupplier}&sort=reward&limit=1`, { user: COURIER })).json();
  const mismatch = await request(`/orders?sort=-reward&cursor=${first.nextCursor}`, { user: COURIER });
  assert.equal(mismatch.status, 400);
  for (const query of ["state=NOPE", "sort=price", "limit=0", "limit=101", "supplierId=x", "cursor=garbage"]) {
    assert.equal((await request(`/orders?${query}`, { user: COURIER })).status, 400, query);
  }
});

test("GET /orders/me lists only the caller's own requests with their state (FR10.2)", async () => {
  const mine = await createOrder({}, OTHER);
  const page = await (await request("/orders/me?limit=100", { user: OTHER })).json();
  assert.ok(page.items.every((item) => item.requesterId === OTHER));
  assert.equal(page.items[0].id, mine.id);
  assert.equal(page.items[0].state, "PENDING");
});
