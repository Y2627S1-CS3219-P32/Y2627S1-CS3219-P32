/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
 * Scope: HTTP and PostgreSQL (pgvector) integration tests: order and supplier event
 * copies, background embedding (through a stand-in OpenAI server, including failures
 * and edits), ranked results with reasons, and preferences. Author review: Pending.
 * Claude Code (Opus 5.5), 2026-11-01. Scope: Supplier arrival, renames and in-flight
 * embeddings; teardown waits for connections to close. Author review: Pending.
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, before, beforeEach, test } from "node:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("Set TEST_DATABASE_URL to a PostgreSQL (with pgvector) connection that can create a disposable test database.");
}

const JWT_SECRET = randomBytes(32).toString("hex");
const INTERNAL_SECRET = randomBytes(32).toString("hex");
const OPENAI_KEY = `sk-test-${randomBytes(8).toString("hex")}`;
const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
const databaseName = `ranking_test_${randomBytes(8).toString("hex")}`;
let createdDatabase = false;
let db, pool, server, baseUrl, job, openai;

// Stand-in for the OpenAI embeddings API: deterministic vectors from the hashing
// embedder, with a switch to make it fail.
const openaiCalls = [];
let openaiFails = false;
let hashingEmbedding;
// While set, the stand-in holds its responses until this promise resolves, so a test
// can change data while an embedding request is in flight.
let openaiHold;

function token(userId) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const content = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: String(userId), iat: now, exp: now + 900 })}`;
  return `${content}.${createHmac("sha256", JWT_SECRET).update(content).digest("base64url")}`;
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

let version = 100;
async function supplier(id, overrides = {}) {
  const response = await push("supplier-events", {
    type: "supplier.created",
    eventId: randomUUID(),
    version: ++version,
    supplier: {
      id,
      name: "Gong Cha",
      type: "Food/Coffee",
      buildingName: "COM2",
      floor: "B1",
      locationDescription: null,
      latitude: "1.294200",
      longitude: "103.773600",
      isActive: true,
      imageUrl: null,
      operatingHours: [],
      ...overrides,
    },
  });
  assert.equal(response.status, 204);
}

const REQUESTER = 1;
const COURIER = 2;
const COM2_SUPPLIER = randomUUID();
const UTOWN_SUPPLIER = randomUUID();

// An order event carrying the full order, as order-service publishes it.
async function orderEvent(order, sequence, type = "order.created") {
  const response = await push("order-events", {
    eventId: randomUUID(),
    type,
    orderId: order.id,
    sequence,
    state: order.state,
    actorId: null,
    commandId: null,
    occurredAt: new Date().toISOString(),
    order,
  });
  assert.equal(response.status, 204);
}

function order(overrides = {}) {
  return {
    id: randomUUID(),
    requesterId: REQUESTER,
    courierId: null,
    supplierId: COM2_SUPPLIER,
    supplierVersion: 1,
    title: "Bubble tea",
    description: "One brown sugar milk tea",
    deliveryLocation: "COM1 lobby",
    creditReward: 5,
    state: "OPEN",
    acceptedAt: null,
    expiresAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// The stored vector is the embedding of exactly this text (pgvector stores 32-bit floats).
async function embeddedText(id, text) {
  const { rows } = await pool.query("select embedding <=> $2::vector as distance from orders where id = $1", [id, JSON.stringify(hashingEmbedding(text))]);
  return rows[0].distance !== null && rows[0].distance < 1e-6;
}

async function until(condition) {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(condition(), "timed out");
}

async function row(id) {
  const { rows } = await pool.query("select state, sequence, title, embedding is not null as embedded, embedding_attempts from orders where id = $1", [id]);
  return rows[0];
}

before(async () => {
  openai = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    openaiCalls.push({ auth: req.headers.authorization, body: JSON.parse(body) });
    if (openaiFails) {
      res.writeHead(429, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "Rate limit" } }));
      return;
    }
    const { input } = JSON.parse(body);
    await openaiHold;
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      data: input.map((text, index) => ({ index, embedding: hashingEmbedding(text) })),
    }));
  }).listen(0, "127.0.0.1");
  await once(openai, "listening");

  await admin.connect();
  await admin.query(`create database "${databaseName}"`);
  createdDatabase = true;

  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  process.env.DATABASE_URL = url.href;
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.INTERNAL_SHARED_SECRET = INTERNAL_SECRET;
  process.env.EMBEDDING_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = OPENAI_KEY;
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${openai.address().port}/v1`;
  process.env.EMBEDDING_MAX_ATTEMPTS = "2";
  process.env.RANK_THRESHOLD_SEMANTIC = "0.3";
  delete process.env.PUBSUB_EMULATOR_HOST;

  ({ hashingEmbedding } = await import("../dist/ranking/embeddings.js"));
  ({ db, pool } = await import("../dist/db/index.js"));
  await migrate(db, { migrationsFolder: "./drizzle" });
  job = await import("../dist/ranking/embedding-job.js");

  const { app } = await import("../dist/app.js");
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  await supplier(COM2_SUPPLIER);
  await supplier(UTOWN_SUPPLIER, { name: "Printing Room", type: "Printing", buildingName: "UTown", latitude: "1.304800", longitude: "103.772700" });
});

beforeEach(async () => {
  // Let any embedding started by the previous test finish before clearing its rows.
  await job.requestEmbedding();
  await pool.query("truncate orders, preferences");
  openaiCalls.length = 0;
  openaiFails = false;
  openaiHold = undefined;
});

after(async () => {
  server?.close();
  openai?.close();
  await pool?.end();
  // pool.end() returns before the server has closed its connections; dropping the database
  // while one is closing makes that connection throw.
  for (let i = 0; i < 100; i++) {
    const { rows } = await admin.query("select count(*)::int as count from pg_stat_activity where datname = $1", [databaseName]);
    if (rows[0].count === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (createdDatabase) await admin.query(`drop database "${databaseName}" with (force)`);
  await admin.end();
});

test("rankings and preferences need a valid token; internal routes need the secret", async () => {
  assert.equal((await request("/rankings")).status, 401);
  assert.equal((await request("/preferences/me")).status, 401);
  assert.equal((await request("/internal/embeddings/process", { method: "POST" })).status, 401);
  assert.equal((await request("/rankings", { user: COURIER })).status, 200);
});

test("order events are copied, only newer sequences apply, and each order is embedded once", async () => {
  const created = order({ state: "PENDING" });
  await orderEvent(created, 1);
  await orderEvent({ ...created, state: "OPEN" }, 2, "order.opened");
  // A late redelivery of the first event is ignored.
  await orderEvent(created, 1);
  await job.requestEmbedding();

  assert.deepEqual(await row(created.id), { state: "OPEN", sequence: 2, title: "Bubble tea", embedded: true, embedding_attempts: 0 });
  assert.equal(openaiCalls.length, 1);
  assert.equal(openaiCalls[0].auth, `Bearer ${OPENAI_KEY}`);
  assert.equal(openaiCalls[0].body.model, "text-embedding-3-small");
  // The pickup place is part of the embedded text.
  assert.deepEqual(openaiCalls[0].body.input, ["Bubble tea\nOne brown sugar milk tea\nPickup: Gong Cha (Food/Coffee)"]);
});

test("an edit that changes the text is embedded again; a state change is not", async () => {
  const created = order();
  await orderEvent(created, 1);
  await job.requestEmbedding();
  await orderEvent({ ...created, title: "Iced coffee" }, 2, "order.edited");
  assert.equal((await row(created.id)).embedded, false);
  await job.requestEmbedding();
  await orderEvent({ ...created, title: "Iced coffee", state: "ACCEPTED", courierId: COURIER, acceptedAt: new Date().toISOString() }, 3, "order.accepted");
  await job.requestEmbedding();

  assert.equal((await row(created.id)).embedded, true);
  assert.equal(openaiCalls.length, 2);
  assert.match(openaiCalls[1].body.input[0], /^Iced coffee/);
});

test("a supplier that arrives after its order was embedded gets the order embedded again with the pickup", async () => {
  const late = randomUUID();
  const created = order({ supplierId: late });
  await orderEvent(created, 1);
  await job.requestEmbedding();
  assert.ok(await embeddedText(created.id, "Bubble tea\nOne brown sugar milk tea"));

  await supplier(late, { name: "LiHO", type: "Food/Coffee" });
  await job.requestEmbedding();
  assert.equal(openaiCalls.length, 2);
  assert.deepEqual(openaiCalls[1].body.input, ["Bubble tea\nOne brown sugar milk tea\nPickup: LiHO (Food/Coffee)"]);
  assert.ok(await embeddedText(created.id, openaiCalls[1].body.input[0]));
});

test("renaming a supplier, or moving an order to another supplier, embeds the order again; other changes do not", async () => {
  const shop = randomUUID();
  await supplier(shop, { name: "Old Name", type: "Food/Coffee" });
  const kept = order({ supplierId: shop });
  const moved = order({ supplierId: shop, title: "Moved order" });
  await orderEvent(kept, 1);
  await orderEvent(moved, 1);
  await job.requestEmbedding();
  const texts = () => openaiCalls.flatMap((call) => call.body.input);
  assert.equal(texts().length, 2);

  // A new location or building does not change the embedded text.
  await supplier(shop, { name: "Old Name", type: "Food/Coffee", buildingName: "UTown", latitude: "1.304800" });
  await job.requestEmbedding();
  assert.equal(texts().length, 2);

  const renamedVersion = version + 1;
  await supplier(shop, { name: "New Name", type: "Printing" });
  // An older version arriving late changes nothing.
  const stale = await push("supplier-events", { type: "supplier.updated", eventId: randomUUID(), version: renamedVersion - 1, supplier: { id: shop, name: "Old Name", type: "Food/Coffee", buildingName: null, latitude: "1.3", longitude: "103.7" } });
  assert.equal(stale.status, 204);
  await job.requestEmbedding();
  assert.deepEqual(texts().slice(2).sort(), [
    "Bubble tea\nOne brown sugar milk tea\nPickup: New Name (Printing)",
    "Moved order\nOne brown sugar milk tea\nPickup: New Name (Printing)",
  ]);
  assert.ok(await embeddedText(kept.id, "Bubble tea\nOne brown sugar milk tea\nPickup: New Name (Printing)"));

  await orderEvent({ ...moved, supplierId: UTOWN_SUPPLIER }, 2, "order.edited");
  assert.equal((await row(moved.id)).embedded, false);
  await job.requestEmbedding();
  assert.ok(await embeddedText(moved.id, "Moved order\nOne brown sugar milk tea\nPickup: Printing Room (Printing)"));
  assert.ok(await embeddedText(kept.id, "Bubble tea\nOne brown sugar milk tea\nPickup: New Name (Printing)"));
});

test("an embedding that was in flight when its supplier changed is not stored; the new text is", async () => {
  const shop = randomUUID();
  await supplier(shop, { name: "Before", type: "Food/Coffee" });
  const created = order({ supplierId: shop });
  let release;
  openaiHold = new Promise((resolve) => { release = resolve; });
  await orderEvent(created, 1);
  const running = job.requestEmbedding();
  await until(() => openaiCalls.length === 1);
  assert.deepEqual(openaiCalls[0].body.input, ["Bubble tea\nOne brown sugar milk tea\nPickup: Before (Food/Coffee)"]);

  // The supplier is renamed while the old text is being embedded.
  await supplier(shop, { name: "After", type: "Food/Coffee" });
  openaiHold = undefined;
  release();
  await running;
  await job.requestEmbedding();

  assert.equal(openaiCalls.length, 2);
  assert.deepEqual(openaiCalls[1].body.input, ["Bubble tea\nOne brown sugar milk tea\nPickup: After (Food/Coffee)"]);
  assert.ok(await embeddedText(created.id, openaiCalls[1].body.input[0]));
});

test("an embedding outage never fails the event; retries back off, then stop", async () => {
  openaiFails = true;
  const created = order();
  await orderEvent(created, 1);
  await job.requestEmbedding();
  // More events during the outage do not retry the failed order straight away.
  await orderEvent(order(), 1);
  await job.requestEmbedding();
  assert.deepEqual(await row(created.id), { state: "OPEN", sequence: 1, title: "Bubble tea", embedded: false, embedding_attempts: 1 });
  assert.equal(openaiCalls.length, 2);
  const { rows: [{ minutes }] } = await pool.query("select round(extract(epoch from embedding_retry_at - now()) / 60) as minutes from orders where id = $1", [created.id]);
  assert.equal(Number(minutes), 1);

  // Once the back-off has passed, the scheduled retry tries both again.
  await pool.query("update orders set embedding_retry_at = now() - interval '1 second'");
  const retried = await request("/internal/embeddings/process", { method: "POST", headers: { "x-internal-secret": INTERNAL_SECRET } });
  assert.deepEqual(await retried.json(), { provider: "openai", embedded: { orders: 0, notes: 0 } });
  assert.equal(openaiCalls.length, 3);
  assert.equal((await row(created.id)).embedding_attempts, 2);

  // EMBEDDING_MAX_ATTEMPTS is 2, so they are not tried again.
  await pool.query("update orders set embedding_retry_at = now() - interval '1 second'");
  await job.processPendingEmbeddings();
  assert.equal(openaiCalls.length, 3);

  // Still ranked, just without the meaning part.
  const body = await (await request("/rankings", { user: COURIER })).json();
  assert.ok(body.items.some((item) => item.orderId === created.id && item.parts.semantic === undefined));
  assert.equal(body.context.unembeddedOrders, 2);
});

test("malformed events are acknowledged and dropped", async () => {
  assert.equal((await push("order-events", { sequence: 1, order: { id: "nope" } })).status, 204);
  assert.equal((await push("supplier-events", { type: "supplier.renamed", version: 1 })).status, 204);
  const { rows } = await pool.query("select count(*)::int as count from orders");
  assert.equal(rows[0].count, 0);
});

test("a courier's past deliveries and location rank similar nearby orders first, with reasons", async () => {
  // Three bubble tea orders the courier delivered earlier today, at this hour.
  for (let i = 0; i < 3; i++) {
    const done = order({ title: `Bubble tea ${i + 1}`, courierId: COURIER, state: "COMPLETE", acceptedAt: new Date(Date.now() - (i + 1) * 60_000).toISOString() });
    await orderEvent(done, 5);
  }
  const tea = order({ title: "Bubble tea again", createdAt: new Date(Date.now() - 60_000).toISOString() });
  const print = order({ title: "Print my notes", description: "20 pages, double sided", supplierId: UTOWN_SUPPLIER, creditReward: 8 });
  const own = order({ requesterId: COURIER, title: "My own bubble tea" });
  const accepted = order({ state: "ACCEPTED", courierId: 9, acceptedAt: new Date().toISOString() });
  for (const item of [tea, print, own, accepted]) await orderEvent(item, 2);
  await job.requestEmbedding();

  const response = await request("/rankings?lat=1.2942&lng=103.7736&limit=10", { user: COURIER });
  assert.equal(response.status, 200);
  const body = await response.json();

  // Only open orders by someone else.
  assert.deepEqual(body.items.map((item) => item.orderId), [tea.id, print.id]);
  assert.deepEqual(body.context, { personalised: true, pastOrders: 3, location: "current", embeddingProvider: "openai", unembeddedOrders: 0 });

  const [first, second] = body.items;
  assert.ok(first.score > second.score);
  const reasons = first.reasons.map((reason) => reason.text);
  assert.ok(reasons.some((text) => text.startsWith("Like 3 orders you've delivered")), reasons.join(" | "));
  assert.ok(reasons.includes("Gong Cha (COM2) is 0 m from you"), reasons.join(" | "));
  assert.ok(reasons.some((text) => text.startsWith("You often take orders like this around")), reasons.join(" | "));
  // The far, unrelated order has no meaning or distance reasons.
  assert.deepEqual(second.reasons.filter((reason) => reason.part === "semantic" || reason.part === "distance"), []);
  for (const part of ["semantic", "distance", "time", "preference", "reward"]) assert.ok(part in first.parts, part);
});

test("only orders the courier has delivered count as past deliveries", async () => {
  const at = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
  // Taken but not yet delivered.
  const taken = ["ACCEPTED", "PICKED_UP", "ACCEPTED"].map((state, i) =>
    order({ title: `Bubble tea ${i + 1}`, courierId: COURIER, state, acceptedAt: at(i + 1) }));
  for (const item of taken) await orderEvent(item, 3);
  const open = order({ title: "Bubble tea again" });
  await orderEvent(open, 2);
  await job.requestEmbedding();

  let body = await (await request("/rankings", { user: COURIER })).json();
  assert.equal(body.context.pastOrders, 0);
  assert.deepEqual(body.items[0].reasons, []);

  // Delivered, then confirmed and settled: each is a past delivery.
  const states = ["DELIVERED", "COMPLETE", "SETTLED"];
  for (const [i, item] of taken.entries()) await orderEvent({ ...item, state: states[i] }, 4, "order.delivered");
  body = await (await request("/rankings", { user: COURIER })).json();
  assert.equal(body.context.pastOrders, 3);
  const reasons = body.items[0].reasons.map((reason) => reason.text);
  assert.ok(reasons.some((text) => text.startsWith("Like 3 orders you've delivered")), reasons.join(" | "));
});

test("rankings check the location and limit", async () => {
  assert.equal((await request("/rankings?lat=1.29", { user: COURIER })).status, 400);
  assert.equal((await request("/rankings?lat=100&lng=103", { user: COURIER })).status, 400);
  assert.equal((await request("/rankings?limit=0", { user: COURIER })).status, 400);
  assert.equal((await request("/rankings?limit=101", { user: COURIER })).status, 400);
});

test("preferences are saved, validated, and their note is embedded and used", async () => {
  assert.deepEqual(await (await request("/preferences/me", { user: COURIER })).json(), { supplierTypes: [], buildings: [], minReward: null, note: null });

  for (const body of [{ minReward: 0 }, { minReward: 1.5 }, { supplierTypes: "Food" }, { note: "x".repeat(501) }, []]) {
    assert.equal((await request("/preferences/me", { user: COURIER, method: "PUT", body })).status, 400, JSON.stringify(body));
  }

  const saved = await request("/preferences/me", {
    user: COURIER,
    method: "PUT",
    body: { supplierTypes: ["Printing", "Printing"], buildings: [], minReward: 6, note: "  printing and photocopying  " },
  });
  assert.deepEqual(await saved.json(), { supplierTypes: ["Printing"], buildings: [], minReward: 6, note: "printing and photocopying" });
  await job.requestEmbedding();

  const tea = order();
  const print = order({ title: "Printing", description: "Print 20 pages for me", supplierId: UTOWN_SUPPLIER, creditReward: 6 });
  await orderEvent(tea, 1);
  await orderEvent(print, 1);
  await job.requestEmbedding();

  const body = await (await request("/rankings", { user: COURIER })).json();
  assert.equal(body.items[0].orderId, print.id);
  assert.deepEqual(body.items[0].reasons.map((reason) => reason.text).sort(), [
    'Matches what you said you like: "printing and photocopying"',
    "Pays at least your minimum of 6 credits",
    "Printing is one of your preferred types",
  ]);

  // Saving the same note again keeps its embedding.
  const calls = openaiCalls.length;
  await request("/preferences/me", { user: COURIER, method: "PUT", body: { supplierTypes: [], note: "printing and photocopying" } });
  await job.requestEmbedding();
  assert.equal(openaiCalls.length, calls);
});
