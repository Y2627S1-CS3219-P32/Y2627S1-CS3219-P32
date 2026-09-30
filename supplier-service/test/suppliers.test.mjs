/**
 * AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
 * Scope: HTTP and PostgreSQL integration checks for GET /suppliers.
 * Author review: Done, tests work as expected.
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-09-29.
 * Scope: Stub user-service, authentication and role-visibility checks for GET, and
 * PUT/DELETE /suppliers/:id checks.
 * Author review: Done.
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-09-30.
 * Scope: GET /types, GET /buildings, and POST /suppliers checks.
 * Author review: Done.
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-09-30.
 * Scope: In-place PUT (with the isActive toggle) and hard DELETE checks.
 * Author review: Pending.
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-09-30.
 * Scope: POST /suppliers operating hours checks.
 * Author review: Pending.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("Set TEST_DATABASE_URL to a PostgreSQL connection with permission to create a disposable test database.");
}

const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
const databaseName = `supplier_routes_test_${randomBytes(8).toString("hex")}`;
let createdDatabase = false;
let db, pool, schema, openingHoursMatch, server, baseUrl, userService;
let foodId, coffeeId, shoppingId;

// Stub user-service GET /me: each bearer token maps to a fixed caller.
const users = {
  "student-token": { id: 1, name: "Student", email: "student@example.com", role: "student" },
  "admin-token": { id: 2, name: "Admin", email: "admin@example.com", role: "admin" },
};

before(async () => {
  userService = createServer((req, res) => {
    const token = req.headers.authorization?.replace(/^Bearer /i, "");
    if (req.url !== "/me") {
      res.writeHead(404).end();
    } else if (token === "broken-token") {
      res.writeHead(500).end();
    } else if (users[token]) {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(users[token]));
    } else {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "A valid bearer token is required" }));
    }
  });
  userService.listen(0, "127.0.0.1");
  await once(userService, "listening");
  process.env.USER_SERVICE_BASE_URL = `http://127.0.0.1:${userService.address().port}`;

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
    if (userService) await new Promise((resolve, reject) => userService.close(error => error ? reject(error) : resolve()));
  } finally {
    try {
      if (pool) await pool.end();
      if (createdDatabase) await admin.query(`DROP DATABASE "${databaseName}"`);
    } finally {
      await admin.end();
    }
  }
});

function request(path, { token, method = "GET", body } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Admins see inactive suppliers too, so filter and ordering checks run as an admin.
async function getSuppliers(query = {}, token = "admin-token") {
  const response = await request(`/suppliers?${new URLSearchParams(query)}`, { token });
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

test("GET requires a bearer token that user-service accepts", async () => {
  for (const token of [undefined, "unknown-token"]) {
    const response = await request("/suppliers", { token });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "A valid bearer token is required" });
  }
  const malformed = await fetch(`${baseUrl}/suppliers`, { headers: { authorization: "Basic abc" } });
  assert.equal(malformed.status, 401);
});

test("GET returns 502 when user-service fails", async () => {
  assert.equal((await request("/suppliers", { token: "broken-token" })).status, 502);
});

test("students do not see inactive suppliers; admins do", async () => {
  const studentRows = await getSuppliers({}, "student-token");
  assert.ok(studentRows.every(row => row.isActive));
  assert.equal(studentRows.some(row => row.name === "B Inactive Cafe"), false);
  const adminRows = await getSuppliers();
  assert.equal(adminRows.find(row => row.name === "B Inactive Cafe").isActive, false);
  assert.equal(adminRows.length, studentRows.length + 1);
});

const validUpdate = {
  name: "Edited Cafe",
  type: "Shopping",
  buildingName: "COM2",
  floor: "3",
  locationDescription: "Beside the lift",
  latitude: 1.2945,
  longitude: "103.7744",
  imageUrl: "https://example.com/cafe.jpeg",
};

async function insertSupplier(name, isActive = true) {
  const [row] = await db.insert(schema.suppliers).values({
    name, supplierTypeId: foodId, latitude: "1.296444", longitude: "103.773032", isActive,
  }).returning();
  return row;
}

test("PUT and DELETE are administrator-only", async () => {
  const supplier = await insertSupplier("Guarded Cafe");
  for (const [method, body] of [["PUT", validUpdate], ["DELETE", undefined]]) {
    assert.equal((await request(`/suppliers/${supplier.id}`, { method, body })).status, 401);
    assert.equal((await request(`/suppliers/${supplier.id}`, { method, body, token: "student-token" })).status, 403);
  }
  const [row] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, supplier.id));
  assert.equal(row.isActive, true);
  assert.equal(row.name, "Guarded Cafe");
});

test("PUT updates the supplier in place and keeps its id, hours, and active state", async () => {
  const original = await insertSupplier("In-place Cafe");
  await db.insert(schema.operatingHours).values([
    { supplierId: original.id, day: 1, openingHrs: "08:00", closingHrs: "12:00" },
    { supplierId: original.id, day: 1, openingHrs: "13:00", closingHrs: "17:00" },
  ]);

  const response = await request(`/suppliers/${original.id}`, { method: "PUT", token: "admin-token", body: validUpdate });
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal(updated.id, original.id);
  assert.equal(updated.isActive, true);
  assert.equal(updated.name, "Edited Cafe");
  assert.equal(updated.type, "Shopping");
  assert.equal(updated.buildingName, "COM2");
  assert.equal(updated.floor, "3");
  assert.equal(updated.locationDescription, "Beside the lift");
  assert.equal(updated.latitude, "1.294500");
  assert.equal(updated.longitude, "103.774400");
  assert.equal(updated.imageUrl, "https://example.com/cafe.jpeg");
  assert.equal(typeof updated.isOpen, "boolean");

  // No copy is left behind under either name.
  const rows = await db.select().from(schema.suppliers).where(inArray(schema.suppliers.name, ["In-place Cafe", "Edited Cafe"]));
  assert.deepEqual(rows.map(row => row.id), [original.id]);
  const hours = await db.select().from(schema.operatingHours).where(eq(schema.operatingHours.supplierId, original.id));
  assert.deepEqual(hours.map(hour => [hour.day, hour.openingHrs, hour.closingHrs]).sort(), [
    [1, "08:00:00", "12:00:00"], [1, "13:00:00", "17:00:00"],
  ]);
});

test("PUT isActive toggles student visibility, and inactive suppliers can still be edited", async () => {
  const supplier = await insertSupplier("Toggle Cafe");
  const body = { ...validUpdate, name: "Toggle Cafe" };

  const hidden = await request(`/suppliers/${supplier.id}`, { method: "PUT", token: "admin-token", body: { ...body, isActive: false } });
  assert.equal(hidden.status, 200);
  assert.equal((await hidden.json()).isActive, false);
  assert.equal((await getSuppliers({ name: "Toggle Cafe" }, "student-token")).length, 0);
  assert.equal((await getSuppliers({ name: "Toggle Cafe" })).length, 1);

  // Omitting isActive keeps the current value.
  const edited = await request(`/suppliers/${supplier.id}`, { method: "PUT", token: "admin-token", body: { ...body, floor: "4" } });
  assert.equal(edited.status, 200);
  const editedRow = await edited.json();
  assert.equal(editedRow.isActive, false);
  assert.equal(editedRow.floor, "4");

  const shown = await request(`/suppliers/${supplier.id}`, { method: "PUT", token: "admin-token", body: { ...body, isActive: true } });
  assert.equal((await shown.json()).isActive, true);
  assert.deepEqual((await getSuppliers({ name: "Toggle Cafe" }, "student-token")).map(row => row.id), [supplier.id]);
});

test("PUT stores blank optional fields as null", async () => {
  const original = await insertSupplier("Sparse Cafe");
  const response = await request(`/suppliers/${original.id}`, {
    method: "PUT",
    token: "admin-token",
    body: { ...validUpdate, name: "Sparse Cafe", buildingName: null, floor: "", locationDescription: "  ", imageUrl: null },
  });
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal(updated.buildingName, null);
  assert.equal(updated.floor, null);
  assert.equal(updated.locationDescription, null);
  assert.equal(updated.imageUrl, null);
});

test("PUT rejects invalid bodies without changing the supplier", async () => {
  const supplier = await insertSupplier("Invalid Edit Cafe");
  const invalidBodies = [
    { ...validUpdate, name: " " },
    { ...validUpdate, name: "x".repeat(257) },
    { ...validUpdate, type: "Unknown type" },
    { ...validUpdate, buildingName: "Unknown building" },
    { ...validUpdate, latitude: 91 },
    { ...validUpdate, longitude: "east" },
    { ...validUpdate, imageUrl: "javascript:alert(1)" },
    { ...validUpdate, floor: 3 },
    { ...validUpdate, isActive: "false" },
    [],
  ];
  for (const body of invalidBodies) {
    const response = await request(`/suppliers/${supplier.id}`, { method: "PUT", token: "admin-token", body });
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(typeof (await response.json()).error, "string");
  }
  const invalidJson = await fetch(`${baseUrl}/suppliers/${supplier.id}`, {
    method: "PUT",
    headers: { authorization: "Bearer admin-token", "content-type": "application/json" },
    body: "{",
  });
  assert.equal(invalidJson.status, 400);
  const rows = await db.select().from(schema.suppliers).where(eq(schema.suppliers.name, "Invalid Edit Cafe"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].isActive, true);
});

test("PUT returns 404 for unknown or malformed ids", async () => {
  for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
    assert.equal((await request(`/suppliers/${id}`, { method: "PUT", token: "admin-token", body: validUpdate })).status, 404);
  }
});

test("DELETE removes the supplier and its hours", async () => {
  const supplier = await insertSupplier("Deleted Cafe");
  await db.insert(schema.operatingHours).values({ supplierId: supplier.id, day: 1, openingHrs: "08:00", closingHrs: "12:00" });

  const response = await request(`/suppliers/${supplier.id}`, { method: "DELETE", token: "admin-token" });
  assert.equal(response.status, 204);
  assert.equal((await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, supplier.id))).length, 0);
  assert.equal((await db.select().from(schema.operatingHours).where(eq(schema.operatingHours.supplierId, supplier.id))).length, 0);
  assert.equal((await getSuppliers({ name: "Deleted Cafe" })).length, 0);

  assert.equal((await request(`/suppliers/${supplier.id}`, { method: "DELETE", token: "admin-token" })).status, 404);
  assert.equal((await request("/suppliers/00000000-0000-4000-8000-000000000000", { method: "DELETE", token: "admin-token" })).status, 404);
  assert.equal((await request("/suppliers/not-a-uuid", { method: "DELETE", token: "admin-token" })).status, 404);
});

test("DELETE also removes inactive suppliers", async () => {
  const supplier = await insertSupplier("Retired Cafe", false);
  assert.equal((await request(`/suppliers/${supplier.id}`, { method: "DELETE", token: "admin-token" })).status, 204);
  assert.equal((await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, supplier.id))).length, 0);
});

test("GET /types and /buildings list every row by name for any logged-in user", async () => {
  for (const token of ["student-token", "admin-token"]) {
    const typesResponse = await request("/types", { token });
    assert.equal(typesResponse.status, 200);
    const typeRows = await typesResponse.json();
    assert.deepEqual(typeRows.map(row => row.name), ["Food", "Food/Coffee", "Shopping"]);
    assert.ok(typeRows.every(row => typeof row.id === "string"));

    const buildingsResponse = await request("/buildings", { token });
    assert.equal(buildingsResponse.status, 200);
    // Order follows the database collation, so only the contents are compared.
    assert.deepEqual((await buildingsResponse.json()).map(row => row.name).sort(), ["COM2", "Central Library"]);
  }
  assert.equal((await request("/types")).status, 401);
  assert.equal((await request("/buildings")).status, 401);
});

test("POST is administrator-only", async () => {
  const body = { ...validUpdate, name: "Guarded New Cafe" };
  assert.equal((await request("/suppliers", { method: "POST", body })).status, 401);
  assert.equal((await request("/suppliers", { method: "POST", body, token: "student-token" })).status, 403);
  const rows = await db.select().from(schema.suppliers).where(eq(schema.suppliers.name, "Guarded New Cafe"));
  assert.equal(rows.length, 0);
});

test("POST creates an active supplier without hours and returns 201", async () => {
  const response = await request("/suppliers", { method: "POST", token: "admin-token", body: { ...validUpdate, name: "Brand New Cafe" } });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(typeof created.id, "string");
  assert.equal(created.name, "Brand New Cafe");
  assert.equal(created.type, "Shopping");
  assert.equal(created.buildingName, "COM2");
  assert.equal(created.floor, "3");
  assert.equal(created.locationDescription, "Beside the lift");
  assert.equal(created.latitude, "1.294500");
  assert.equal(created.longitude, "103.774400");
  assert.equal(created.imageUrl, "https://example.com/cafe.jpeg");
  assert.equal(created.isActive, true);
  assert.equal(created.isOpen, false);
  assert.equal(Object.hasOwn(created, "supplierTypeId"), false);

  const hours = await db.select().from(schema.operatingHours).where(eq(schema.operatingHours.supplierId, created.id));
  assert.equal(hours.length, 0);
  assert.ok((await getSuppliers({ name: "Brand New Cafe" }, "student-token")).some(row => row.id === created.id));
});

test("POST accepts a supplier without a building and rejects invalid bodies", async () => {
  const response = await request("/suppliers", {
    method: "POST",
    token: "admin-token",
    body: { ...validUpdate, name: "Roaming Cart", buildingName: null, floor: "", locationDescription: null, imageUrl: "" },
  });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.buildingName, null);
  assert.equal(created.floor, null);
  assert.equal(created.imageUrl, null);

  for (const body of [
    { ...validUpdate, name: "Rejected Cafe", type: "Unknown type" },
    { ...validUpdate, name: "Rejected Cafe", buildingName: "Unknown building" },
    { ...validUpdate, name: "Rejected Cafe", latitude: "north" },
    { ...validUpdate, name: "" },
  ]) {
    const rejected = await request("/suppliers", { method: "POST", token: "admin-token", body });
    assert.equal(rejected.status, 400);
    assert.equal(typeof (await rejected.json()).error, "string");
  }
  const rows = await db.select().from(schema.suppliers).where(eq(schema.suppliers.name, "Rejected Cafe"));
  assert.equal(rows.length, 0);
});

test("POST can create an inactive supplier", async () => {
  const response = await request("/suppliers", { method: "POST", token: "admin-token", body: { ...validUpdate, name: "Hidden New Cafe", isActive: false } });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).isActive, false);
  assert.equal((await getSuppliers({ name: "Hidden New Cafe" }, "student-token")).length, 0);
});

test("POST stores operating hours, including 24-hour and overnight periods", async () => {
  const operatingHours = Array.from({ length: 7 }, (_, day) => ({ day, openingHrs: "00:00", closingHrs: "24:00" }));
  const response = await request("/suppliers", { method: "POST", token: "admin-token", body: { ...validUpdate, name: "Always Open Cafe", operatingHours } });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.isOpen, true);
  const hours = await db.select().from(schema.operatingHours).where(eq(schema.operatingHours.supplierId, created.id));
  assert.equal(hours.length, 7);

  const split = await request("/suppliers", {
    method: "POST",
    token: "admin-token",
    body: {
      ...validUpdate,
      name: "Split Shift Bar",
      operatingHours: [
        { day: 1, openingHrs: "09:00", closingHrs: "12:00" },
        { day: 1, openingHrs: "12:00", closingHrs: "15:00" },
        { day: 1, openingHrs: "22:00", closingHrs: "02:00" },
        { day: 2, openingHrs: "02:00", closingHrs: "05:00" },
        { day: 6, openingHrs: "23:00", closingHrs: "00:00" },
        { day: 0, openingHrs: "00:00", closingHrs: "01:00" },
      ],
    },
  });
  assert.equal(split.status, 201);
  const splitRows = await db.select().from(schema.operatingHours).where(eq(schema.operatingHours.supplierId, (await split.json()).id));
  assert.deepEqual(
    splitRows.map(row => `${row.day} ${row.openingHrs}-${row.closingHrs}`).sort(),
    ["0 00:00:00-01:00:00", "1 09:00:00-12:00:00", "1 12:00:00-15:00:00", "1 22:00:00-02:00:00", "2 02:00:00-05:00:00", "6 23:00:00-00:00:00"],
  );
});

test("POST rejects invalid or overlapping operating hours without creating the supplier", async () => {
  for (const operatingHours of [
    "always",
    [{ day: 7, openingHrs: "09:00", closingHrs: "17:00" }],
    [{ day: 1.5, openingHrs: "09:00", closingHrs: "17:00" }],
    [{ day: 1, openingHrs: "9am", closingHrs: "17:00" }],
    [{ day: 1, openingHrs: "24:00", closingHrs: "17:00" }],
    [{ day: 1, openingHrs: "09:00", closingHrs: "09:00" }],
    [{ day: 1, openingHrs: "09:00", closingHrs: "17:00" }, { day: 1, openingHrs: "09:00", closingHrs: "10:00" }],
    [{ day: 1, openingHrs: "09:00", closingHrs: "17:00" }, { day: 1, openingHrs: "16:00", closingHrs: "18:00" }],
    [{ day: 1, openingHrs: "22:00", closingHrs: "03:00" }, { day: 2, openingHrs: "02:00", closingHrs: "05:00" }],
    [{ day: 6, openingHrs: "22:00", closingHrs: "03:00" }, { day: 0, openingHrs: "02:00", closingHrs: "05:00" }],
  ]) {
    const rejected = await request("/suppliers", { method: "POST", token: "admin-token", body: { ...validUpdate, name: "Bad Hours Cafe", operatingHours } });
    assert.equal(rejected.status, 400, JSON.stringify(operatingHours));
    assert.equal(typeof (await rejected.json()).error, "string");
  }
  const rows = await db.select().from(schema.suppliers).where(eq(schema.suppliers.name, "Bad Hours Cafe"));
  assert.equal(rows.length, 0);
});
