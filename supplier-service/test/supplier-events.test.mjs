/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
 * Scope: supplier-events outbox checks: events and snapshots for POST, PUT, DELETE, and
 * type/building renames, publish failures and the worker's sweep, and seeded suppliers.
 * Author review: Pending.
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { once } from "node:events";
import { after, before, beforeEach, test } from "node:test";
import { isNull } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("Set TEST_DATABASE_URL to a PostgreSQL connection with permission to create a disposable test database.");
}

const jwtSecret = "test-jwt-secret-that-is-at-least-32-bytes";
process.env.JWT_SECRET = jwtSecret;

const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
const databaseName = `supplier_events_test_${randomBytes(8).toString("hex")}`;
let createdDatabase = false;
let db, pool, schema, events, server, baseUrl, workerServer, workerUrl;

// Messages the in-memory publisher received, and supplier ids it should fail for.
let published = [];
const failing = new Set();

function adminToken() {
  const content = [{ alg: "HS256", typ: "JWT" }, { sub: "1", exp: Math.floor(Date.now() / 1000) + 900 }]
    .map(part => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".");
  return `${content}.${createHmac("sha256", jwtSecret).update(content).digest("base64url")}`;
}

before(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  createdDatabase = true;
  const testUrl = new URL(process.env.TEST_DATABASE_URL);
  testUrl.pathname = `/${databaseName}`;
  process.env.DATABASE_URL = testUrl.toString();

  ({ db, pool } = await import("../dist/db/index.js"));
  schema = await import("../dist/db/schema.js");
  await migrate(db, { migrationsFolder: "./drizzle" });
  events = await import("../dist/supplier-events.js");
  events.setPublisher(async (data, orderingKey, attributes) => {
    if (failing.has(orderingKey)) throw new Error("Pub/Sub unavailable");
    published.push({ data, orderingKey, attributes });
  });

  await db.insert(schema.users).values({ id: 1, displayName: "Admin", role: "admin", version: 1 });
  await db.insert(schema.types).values([{ name: "Food" }, { name: "Shopping" }]);
  await db.insert(schema.buildings).values([{ name: "COM2" }]);

  const { app } = await import("../dist/index.js");
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const worker = await import("../dist/worker.js");
  workerServer = worker.app.listen(0, "127.0.0.1");
  await once(workerServer, "listening");
  workerUrl = `http://127.0.0.1:${workerServer.address().port}`;
});

after(async () => {
  try {
    for (const running of [server, workerServer]) {
      if (running) await new Promise((resolve, reject) => running.close(error => error ? reject(error) : resolve()));
    }
  } finally {
    try {
      if (events) await events.outboxIdle();
      if (pool) await pool.end();
      if (createdDatabase) await admin.query(`DROP DATABASE "${databaseName}"`);
    } finally {
      await admin.end();
    }
  }
});

beforeEach(() => {
  published = [];
  failing.clear();
});

// Sends an administrator request, then waits for the relay it starts.
async function request(path, method = "GET", body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${adminToken()}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await events.outboxIdle();
  return response;
}

const supplierBody = {
  name: "Event Cafe",
  type: "Food",
  buildingName: "COM2",
  floor: "1",
  locationDescription: "Near the lift",
  latitude: 1.294,
  longitude: 103.774,
  imageUrl: null,
  operatingHours: [
    { day: 1, openingHrs: "09:00", closingHrs: "17:00" },
    { day: 5, openingHrs: "22:00", closingHrs: "24:00" },
  ],
};

async function createSupplier(overrides = {}) {
  const response = await request("/suppliers", "POST", { ...supplierBody, ...overrides });
  assert.equal(response.status, 201);
  return response.json();
}

test("POST publishes supplier.created with the full snapshot, keyed by supplier id", async () => {
  const supplier = await createSupplier();
  assert.equal(published.length, 1);
  const [{ data, orderingKey, attributes }] = published;
  assert.equal(orderingKey, supplier.id);
  assert.deepEqual(attributes, { type: "supplier.created", supplierId: supplier.id });
  assert.equal(data.type, "supplier.created");
  assert.match(data.eventId, /^[0-9a-f-]{36}$/);
  assert.ok(Number.isSafeInteger(data.version) && data.version > 0);
  assert.deepEqual(data.supplier, {
    id: supplier.id,
    name: "Event Cafe",
    type: "Food",
    buildingName: "COM2",
    floor: "1",
    locationDescription: "Near the lift",
    latitude: "1.294000",
    longitude: "103.774000",
    isActive: true,
    imageUrl: null,
    operatingHours: supplierBody.operatingHours,
  });
});

test("PUT publishes supplier.updated with a higher version and the new state", async () => {
  const supplier = await createSupplier();
  const createdVersion = published[0].data.version;
  published = [];
  const response = await request(`/suppliers/${supplier.id}`, "PUT", {
    ...supplierBody, name: "Renamed Cafe", type: "Shopping", buildingName: null, isActive: false, operatingHours: [],
  });
  assert.equal(response.status, 200);
  assert.equal(published.length, 1);
  const { data } = published[0];
  assert.equal(data.type, "supplier.updated");
  assert.ok(data.version > createdVersion);
  assert.equal(data.supplier.name, "Renamed Cafe");
  assert.equal(data.supplier.type, "Shopping");
  assert.equal(data.supplier.buildingName, null);
  assert.equal(data.supplier.isActive, false);
  assert.deepEqual(data.supplier.operatingHours, []);
});

test("DELETE publishes supplier.deleted with only the supplier id", async () => {
  const supplier = await createSupplier();
  published = [];
  assert.equal((await request(`/suppliers/${supplier.id}`, "DELETE")).status, 204);
  assert.equal(published.length, 1);
  const { data, attributes } = published[0];
  assert.deepEqual(Object.keys(data).sort(), ["eventId", "supplierId", "type", "version"]);
  assert.equal(data.type, "supplier.deleted");
  assert.equal(data.supplierId, supplier.id);
  assert.deepEqual(attributes, { type: "supplier.deleted", supplierId: supplier.id });
});

test("rejected writes publish nothing", async () => {
  assert.equal((await request("/suppliers", "POST", { ...supplierBody, type: "Unknown" })).status, 400);
  assert.equal((await request("/suppliers/00000000-0000-4000-8000-000000000000", "DELETE")).status, 404);
  assert.deepEqual(published, []);
});

test("renaming a type or building publishes supplier.updated for each supplier using it", async () => {
  const [{ id: typeId }] = await db.insert(schema.types).values({ name: "Drinks" }).returning();
  const [{ id: buildingId }] = await db.insert(schema.buildings).values({ name: "UTown" }).returning();
  const first = await createSupplier({ name: "Drinks A", type: "Drinks", buildingName: "UTown" });
  const second = await createSupplier({ name: "Drinks B", type: "Drinks", buildingName: null });
  published = [];

  assert.equal((await request(`/types/${typeId}`, "PUT", { name: "Beverages" })).status, 200);
  assert.deepEqual(published.map(({ data }) => [data.type, data.supplier.id, data.supplier.type]).sort(), [
    ["supplier.updated", first.id, "Beverages"],
    ["supplier.updated", second.id, "Beverages"],
  ].sort());

  published = [];
  assert.equal((await request(`/buildings/${buildingId}`, "PUT", { name: "University Town" })).status, 200);
  assert.deepEqual(published.map(({ data }) => [data.supplier.id, data.supplier.buildingName]), [[first.id, "University Town"]]);

  // Creating a type or building changes no supplier.
  published = [];
  assert.equal((await request("/types", "POST", { name: "Unused" })).status, 201);
  assert.deepEqual(published, []);
});

test("events that fail to publish stay in the outbox, in order, until the worker's sweep sends them", async () => {
  const supplier = await createSupplier();
  published = [];
  failing.add(supplier.id);
  await request(`/suppliers/${supplier.id}`, "PUT", { ...supplierBody, name: "First edit" });
  await request(`/suppliers/${supplier.id}`, "PUT", { ...supplierBody, name: "Second edit" });
  assert.deepEqual(published, []);
  const pending = await db.select().from(schema.supplierEvents).where(isNull(schema.supplierEvents.publishedAt));
  assert.equal(pending.length, 2);

  failing.clear();
  const response = await fetch(`${workerUrl}/outbox/publish`, { method: "POST" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { published: 2 });
  assert.deepEqual(published.map(({ data }) => data.supplier.name), ["First edit", "Second edit"]);
  assert.ok(published[0].data.version < published[1].data.version);

  // Already-published rows are not sent again.
  published = [];
  assert.deepEqual(await (await fetch(`${workerUrl}/outbox/publish`, { method: "POST" })).json(), { published: 0 });
  assert.deepEqual(published, []);
});

test("a failing supplier does not hold back other suppliers' events", async () => {
  const blocked = await createSupplier({ name: "Blocked" });
  const other = await createSupplier({ name: "Other" });
  published = [];
  failing.add(blocked.id);
  await request(`/suppliers/${blocked.id}`, "PUT", { ...supplierBody, name: "Blocked edit" });
  await request(`/suppliers/${other.id}`, "PUT", { ...supplierBody, name: "Other edit" });
  assert.deepEqual(published.map(({ data }) => data.supplier.name), ["Other edit"]);
  failing.clear();
  await events.publishPendingSupplierEvents();
});

test("seeding records supplier.created only for newly inserted suppliers", async () => {
  const { seedSuppliers } = await import("../dist/db/seed.js");
  const { supplierSeedData } = await import("../dist/db/seed-data.js");
  await events.publishPendingSupplierEvents();
  published = [];

  await db.transaction(tx => seedSuppliers(tx));
  assert.equal(await events.publishPendingSupplierEvents(), supplierSeedData.length);
  assert.deepEqual(
    published.map(({ data }) => data.supplier.id).sort(),
    supplierSeedData.map(row => row.id).sort(),
  );
  assert.ok(published.every(({ data }) => data.type === "supplier.created" && data.supplier.operatingHours.length === 7));

  published = [];
  await db.transaction(tx => seedSuppliers(tx));
  assert.equal(await events.publishPendingSupplierEvents(), 0);
});
