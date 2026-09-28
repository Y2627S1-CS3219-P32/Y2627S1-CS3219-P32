/**
 * AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
 * Scope: HTTP and PostgreSQL integration checks for GET /suppliers.
 * Author review: Done, tests work as expected.
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
const databaseName = `supplier_routes_test_${randomBytes(8).toString("hex")}`;
let createdDatabase = false;
let db, pool, schema, openingHoursMatch, server, baseUrl;
let foodId, coffeeId, shoppingId;

before(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  createdDatabase = true;
  const testUrl = new URL(process.env.TEST_DATABASE_URL);
  testUrl.pathname = `/${databaseName}`;
  process.env.DATABASE_URL = testUrl.toString();

  ({ db, pool } = await import("../dist/db/index.js"));
  schema = await import("../dist/db/schema.js");
  ({ openingHoursMatch } = await import("../dist/db/opening-hours.js"));
  await migrate(db, { migrationsFolder: "./drizzle" });
  const { app } = await import("../dist/index.js");
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const typeRows = await db.insert(schema.types).values([
    { name: "Food" }, { name: "Food/Coffee" }, { name: "Shopping" },
  ]).returning();
  foodId = typeRows.find(row => row.name === "Food").id;
  coffeeId = typeRows.find(row => row.name === "Food/Coffee").id;
  shoppingId = typeRows.find(row => row.name === "Shopping").id;
  const [library, computing] = await db.insert(schema.buildings).values([
    { name: "Central Library" }, { name: "COM2" },
  ]).returning();

  const rows = await db.insert(schema.suppliers).values([
    { name: "Z Open Cafe", supplierTypeId: foodId, buildingId: library.id, isActive: true },
    { name: "A Closed Cafe", supplierTypeId: foodId, isActive: true },
    { name: "B Inactive Cafe", supplierTypeId: foodId, isActive: false },
    { name: "D Shop", supplierTypeId: shoppingId, buildingId: computing.id, isActive: true },
    { name: "Coffee category", supplierTypeId: coffeeId, isActive: true },
    { name: "100%_Coffee\\Bar", supplierTypeId: foodId, isActive: true },
    { name: "100xXCoffeeBar", supplierTypeId: foodId, isActive: true },
    { name: "C Multi-period", supplierTypeId: foodId, isActive: true },
  ].map(row => ({ ...row, latitude: "1.296444", longitude: "103.773032" }))).returning();
  const periods = [];
  for (const row of rows.filter(row => ["Z Open Cafe", "B Inactive Cafe", "C Multi-period"].includes(row.name))) {
    for (let day = 0; day < 7; day++) {
      periods.push({ supplierId: row.id, day, openingHrs: "00:00", closingHrs: "24:00" });
      if (row.name === "C Multi-period") {
        periods.push({ supplierId: row.id, day, openingHrs: "00:01", closingHrs: "24:00" });
      }
    }
  }
  await db.insert(schema.operatingHours).values(periods);
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

async function getSuppliers(query = {}) {
  const response = await fetch(`${baseUrl}/suppliers?${new URLSearchParams(query)}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  return response.json();
}

test("returns all suppliers once, with open suppliers first and inactive suppliers closed", async () => {
  const rows = await getSuppliers();
  assert.equal(rows.length, 8);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.deepEqual(rows.filter(row => row.isOpen).map(row => row.name), ["C Multi-period", "Z Open Cafe"]);
  assert.ok(rows.slice(0, 2).every(row => row.isOpen));
  assert.ok(rows.slice(2).every(row => !row.isOpen));
  assert.equal(rows.find(row => row.name === "B Inactive Cafe").isOpen, false);
  assert.equal(rows.find(row => row.name === "A Closed Cafe").isOpen, false);
  assert.equal(typeof rows[0].isOpen, "boolean");
  assert.equal(rows[0].latitude, "1.296444");
  assert.equal(rows[0].buildingName, null);
  assert.ok(rows[0].createdAt);
});

test("returns joined type and building names, omits their IDs, and retains suppliers without buildings", async () => {
  const rows = await getSuppliers();
  const cafe = rows.find(row => row.name === "Z Open Cafe");
  assert.equal(cafe.type, "Food");
  assert.equal(cafe.buildingName, "Central Library");
  const shop = rows.find(row => row.name === "D Shop");
  assert.equal(shop.type, "Shopping");
  assert.equal(shop.buildingName, "COM2");
  assert.equal(rows.find(row => row.name === "A Closed Cafe").buildingName, null);
  for (const row of rows) {
    assert.equal(Object.hasOwn(row, "supplierTypeId"), false);
    assert.equal(Object.hasOwn(row, "buildingId"), false);
    assert.equal(typeof row.id, "string");
  }
});

test("name is a case-insensitive partial match", async () => {
  assert.deepEqual((await getSuppliers({ name: "cAf" })).map(row => row.name), [
    "Z Open Cafe", "A Closed Cafe", "B Inactive Cafe",
  ]);
});

test("type uses an exact name, including names containing a slash", async () => {
  const food = await getSuppliers({ type: "Food" });
  assert.equal(food.length, 6);
  assert.ok(food.every(row => row.type === "Food"));
  assert.deepEqual((await getSuppliers({ type: "Food/Coffee" })).map(row => row.name), ["Coffee category"]);
});

test("name and type combine as AND, and empty matches return 200 with []", async () => {
  assert.equal((await getSuppliers({ name: "cafe", type: "Food" })).length, 3);
  assert.deepEqual(await getSuppliers({ name: "cafe", type: "Shopping" }), []);
  assert.deepEqual(await getSuppliers({ name: "does-not-exist" }), []);
  assert.deepEqual(await getSuppliers({ type: "does-not-exist" }), []);
});

test("name treats SQL wildcard and quote characters as literal search text", async () => {
  for (const name of ["%", "_", "\\"]) {
    assert.deepEqual((await getSuppliers({ name })).map(row => row.name), ["100%_Coffee\\Bar"]);
  }
  assert.deepEqual(await getSuppliers({ name: "' OR 1=1 --" }), []);
});

test("Singapore opening periods handle boundaries, gaps, overnight hours, and Saturday-to-Sunday rollover", async () => {
  const cases = [
    { label: "before opening", hours: [[0, "09:00", "18:00"]], at: "2026-09-27T08:59:59+08:00", open: false },
    { label: "at opening", hours: [[0, "09:00", "18:00"]], at: "2026-09-27T09:00:00+08:00", open: true },
    { label: "before closing", hours: [[0, "09:00", "18:00"]], at: "2026-09-27T17:59:59+08:00", open: true },
    { label: "at closing", hours: [[0, "09:00", "18:00"]], at: "2026-09-27T18:00:00+08:00", open: false },
    { label: "overnight starts", hours: [[6, "22:00", "02:00"]], at: "2026-09-26T22:00:00+08:00", open: true },
    { label: "Sunday carryover from Saturday, UTC input", hours: [[6, "22:00", "02:00"]], at: "2026-09-26T17:00:00Z", open: true },
    { label: "overnight closes", hours: [[6, "22:00", "02:00"]], at: "2026-09-27T02:00:00+08:00", open: false },
    { label: "not yesterday's daytime opening", hours: [[6, "09:00", "18:00"]], at: "2026-09-27T10:00:00+08:00", open: false },
    { label: "midday break", hours: [[0, "08:00", "12:00"], [0, "13:00", "17:00"]], at: "2026-09-27T12:30:00+08:00", open: false },
    { label: "second period", hours: [[0, "08:00", "12:00"], [0, "13:00", "17:00"]], at: "2026-09-27T13:00:00+08:00", open: true },
    { label: "no hours", hours: [], at: "2026-09-27T10:00:00+08:00", open: false },
  ];
  const [supplier] = await db.insert(schema.suppliers).values({
    name: "Clock checks", supplierTypeId: foodId, latitude: "0", longitude: "0", isActive: true,
  }).returning();
  for (const entry of cases) {
    await db.delete(schema.operatingHours).where(eq(schema.operatingHours.supplierId, supplier.id));
    if (entry.hours.length) {
      await db.insert(schema.operatingHours).values(entry.hours.map(([day, openingHrs, closingHrs]) => ({
        supplierId: supplier.id, day, openingHrs, closingHrs,
      })));
    }
    const rows = await db.select({ isOpen: openingHoursMatch(new Date(entry.at), "Asia/Singapore") })
      .from(schema.suppliers).where(eq(schema.suppliers.id, supplier.id));
    assert.equal(rows[0].isOpen, entry.open, entry.label);
  }
});
