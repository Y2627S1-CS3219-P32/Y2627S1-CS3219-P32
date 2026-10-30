/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
 * Scope: HTTP and PostgreSQL checks for the user-events push worker: creation, updates,
 * stale and repeated deliveries, deletion tombstones, and malformed messages.
 * Author review: Pending.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("Set TEST_DATABASE_URL to a PostgreSQL connection with permission to create a disposable test database.");
}

const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
const databaseName = `supplier_user_events_test_${randomBytes(8).toString("hex")}`;
let createdDatabase = false;
let db, pool, schema, server, baseUrl;

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
  const { app } = await import("../dist/worker.js");
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  try {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } finally {
    try {
      if (pool) await pool.end();
      if (createdDatabase) await admin.query(`DROP DATABASE "${databaseName}"`);
    } finally {
      await admin.end();
    }
  }
});

// Wraps an event the way a Pub/Sub push subscription delivers it.
function push(event) {
  const data = typeof event === "string" ? event : Buffer.from(JSON.stringify(event)).toString("base64");
  return fetch(`${baseUrl}/pubsub/user-events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: { data, messageId: "1" }, subscription: "test" }),
  });
}

function snapshot(id, overrides = {}) {
  return {
    id, name: "Alex Smith", displayName: "Alex-Smith", email: "alex@u.nus.edu",
    role: "student", passwordHash: "scrypt$not-a-plaintext-password", ...overrides,
  };
}

async function localUser(id) {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  return row;
}

test("user.created stores the id, display name, role and version, but not the password hash", async () => {
  const response = await push({ eventId: "e1", version: 1, type: "user.created", user: snapshot(10) });
  assert.equal(response.status, 204);
  const row = await localUser(10);
  assert.deepEqual(row, { id: 10, displayName: "Alex-Smith", role: "student", version: 1, deletedAt: null });
});

test("user.updated replaces the display name and role", async () => {
  await push({ eventId: "e2", version: 2, type: "user.created", user: snapshot(11) });
  await push({ eventId: "e3", version: 3, type: "user.updated", user: snapshot(11, { displayName: "Admin-Alex", role: "admin" }) });
  const row = await localUser(11);
  assert.equal(row.displayName, "Admin-Alex");
  assert.equal(row.role, "admin");
  assert.equal(row.version, 3);
});

test("older and repeated events do not overwrite newer state", async () => {
  await push({ eventId: "e5", version: 5, type: "user.updated", user: snapshot(12, { role: "admin" }) });
  assert.equal((await push({ eventId: "e4", version: 4, type: "user.created", user: snapshot(12) })).status, 204);
  assert.equal((await push({ eventId: "e5", version: 5, type: "user.updated", user: snapshot(12, { role: "admin" }) })).status, 204);
  const row = await localUser(12);
  assert.equal(row.role, "admin");
  assert.equal(row.version, 5);
});

test("user.deleted keeps a tombstone", async () => {
  await push({ eventId: "e6", version: 6, type: "user.created", user: snapshot(13) });
  assert.equal((await push({ eventId: "e7", version: 7, type: "user.deleted", userId: 13 })).status, 204);
  const row = await localUser(13);
  assert.ok(row.deletedAt instanceof Date);
  assert.equal(row.version, 7);
});

test("a deletion that arrives before the creation stops the older creation from restoring the user", async () => {
  await push({ eventId: "e9", version: 9, type: "user.deleted", userId: 14 });
  await push({ eventId: "e8", version: 8, type: "user.created", user: snapshot(14) });
  const row = await localUser(14);
  assert.ok(row.deletedAt instanceof Date);
  assert.equal(row.displayName, null);
  assert.equal(row.version, 9);
});

test("malformed messages are acknowledged and change nothing", async () => {
  const before = await db.select().from(schema.users);
  for (const event of [
    "not base64 json",
    { eventId: "e10", version: 10, type: "user.renamed", userId: 15 },
    { eventId: "e11", version: 0, type: "user.deleted", userId: 15 },
    { eventId: "e12", version: 12, type: "user.created", user: { id: 15, role: "student" } },
    { eventId: "e13", version: 13, type: "user.deleted", userId: -1 },
  ]) {
    assert.equal((await push(event)).status, 204);
  }
  const missingData = await fetch(`${baseUrl}/pubsub/user-events`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  assert.equal(missingData.status, 204);
  assert.deepEqual(await db.select().from(schema.users), before);
});

test("GET /health reports ok", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});
