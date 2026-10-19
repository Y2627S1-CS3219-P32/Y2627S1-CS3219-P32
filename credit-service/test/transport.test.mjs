import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import express from "express";
import { createApp } from "../dist/app.js";
import { verifyAccessToken } from "../dist/http-handler/auth.js";
import { errorHandler } from "../dist/http-handler/errors.js";
import { CreditError } from "../dist/common/types.js";
import { config } from "../dist/config.js";
import { pool } from "../dist/db/index.js";
import { migrateDatabase } from "../dist/db/migrate.js";
import { parseCommand, parseUserEvent } from "../dist/event-handler/parsers.js";

before(migrateDatabase);
beforeEach(async () => {
  await pool.query("TRUNCATE credit_outbox,credit_transactions,credit_orders,credit_accounts CASCADE");
});
after(() => pool.end());
const count = async (table) => Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
const headers = { "content-type": "application/json", "x-internal-secret": "transport-test" };
async function withServer(app, run) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
async function withCreditApi(run) {
  const settings = { internalSharedSecret: config.internalSharedSecret, jwtSecret: config.jwtSecret };
  config.internalSharedSecret = "transport-test";
  config.jwtSecret = "test-secret";
  try {
    await withServer(createApp(), run);
  } finally {
    Object.assign(config, settings);
  }
}
const post = (base, path, value) => fetch(base + path, {
  method: "POST", headers, body: JSON.stringify(envelope(value)),
});
const createUser = (base, id) => post(base, "/internal/pubsub/user-events", {
  type: "user.created", eventId: randomUUID(), user: { id },
});
const jwt = (payload, secret = "test-secret") => {
  const content = [{ alg: "HS256", typ: "JWT" }, payload]
    .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
    .join(".");
  return `${content}.${createHmac("sha256", secret).update(content).digest("base64url")}`;
};
test("JWT validates signature, header, expiry and integer string subject", () => {
  const good = jwt({ sub: "1", exp: 200 });
  assert.equal(verifyAccessToken(good, "test-secret", 100), 1);
  assert.equal(verifyAccessToken(good, "wrong", 100), undefined);
  for (const sub of [1, "0", "1.5", "2147483648"])
    assert.equal(
      verifyAccessToken(jwt({ sub, exp: 200 }), "test-secret", 100),
      undefined,
    );
  assert.equal(verifyAccessToken(good, "test-secret", 200), undefined);
});
const wire = (type = "credit.reserve", extra = {}) => ({
  type,
  requestId: randomUUID().toUpperCase(),
  correlationId: randomUUID().toUpperCase(),
  orderId: randomUUID().toUpperCase(),
  ...(type === "credit.transfer"
    ? { courierId: 2 }
    : { requesterId: 1, amount: 120 }),
  ...(type === "credit.release" ? { reason: "Cancelled by requester" } : {}),
  ...extra,
});
const envelope = (value) => ({
  message: { data: Buffer.from(JSON.stringify(value)).toString("base64") },
});
test("user parser normalizes lifecycle events and rejects invalid identities", () => {
  const eventId = randomUUID().toUpperCase();
  for (const type of ["user.created", "user.deleted", "user.updated"]) {
    const identity = type === "user.deleted" ? { userId: 1 } : { user: { id: 1 } };
    assert.deepEqual(parseUserEvent({ type, eventId, ...identity }), {
      type,
      eventId: eventId.toLowerCase(),
      userId: 1,
    });
    for (const id of [0, -1, 1.5, "1", 2147483648, undefined])
      assert.throws(
        () => parseUserEvent({
          type,
          eventId,
          ...(type === "user.deleted" ? { userId: id } : { user: { id } }),
        }),
        { code: "INVALID_EVENT" },
      );
  }
  for (const value of [
    null,
    [],
    {},
    { type: "user.unknown", eventId, user: { id: 1 } },
    { type: "user.created", eventId: "bad", user: { id: 1 } },
    { type: "user.created", eventId, userId: 1 },
    { type: "user.updated", eventId, user: null },
    { type: "user.deleted", eventId, user: { id: 1 } },
  ])
    assert.throws(() => parseUserEvent(value), { code: "INVALID_EVENT" });
});

test("command parser validates explicit variants and normalizes UUIDs", () => {
  for (const type of ["credit.reserve", "credit.release", "credit.transfer"]) {
    const input = wire(type);
    const parsed = parseCommand(input);
    assert.equal(parsed.kind, type.split(".")[1].toUpperCase());
    for (const key of ["requestId", "correlationId", "orderId"])
      assert.equal(parsed[key], input[key].toLowerCase());
  }
  for (const value of [
    null,
    [],
    {},
    wire("credit.unknown"),
    wire(undefined, { orderId: "bad" }),
    ...[0, -1, 1.5, "120", 2147483648].map((amount) =>
      wire(undefined, { amount }),
    ),
    wire(undefined, { requesterId: 0 }),
    wire("credit.transfer", { courierId: 0 }),
    ...[undefined, " ", "x".repeat(201)].map((reason) =>
      wire("credit.release", { reason }),
    ),
  ])
    assert.throws(() => parseCommand(value), { code: "INVALID_COMMAND" });
  assert.equal(
    parseCommand(wire(undefined, { amount: 2147483647 })).amount,
    2147483647,
  );
  assert.equal(
    parseCommand(wire("credit.release", { reason: "x".repeat(200) })).reason
      .length,
    200,
  );
});

test("HTTP rejects forged deliveries and unauthenticated reads without changing accounts", async () => {
  await withCreditApi(async (base) => {
    for (const path of ["/internal/pubsub/credit-commands", "/internal/pubsub/user-events"]) {
      const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { code: "UNAUTHORIZED" });
    }
    assert.equal((await fetch(base + "/api/v1/credits/me")).status, 401);
    assert.equal(await count("credit_accounts"), 0);
  });
});

test("health endpoints use the database and lifecycle delivery initializes and deactivates accounts", async () => {
  await withCreditApi(async (base) => {
    for (const path of ["/health/live", "/health/ready"])
      assert.equal((await fetch(base + path)).status, 200);
    assert.equal((await createUser(base, 1)).status, 200);
    assert.equal(await count("credit_accounts"), 1);
    assert.equal(await count("credit_transactions"), 1);
    const token = jwt({ sub: "1", exp: Math.floor(Date.now() / 1000) + 60 });
    const read = () => fetch(base + "/api/v1/credits/me", { headers: { authorization: `Bearer ${token}` } });
    const balance = await read();
    assert.deepEqual(await balance.json(), { totalCredits: Number(config.initialCredits), reservedCredits: 0, availableCredits: Number(config.initialCredits) });
    assert.equal((await post(base, "/internal/pubsub/user-events", {
      type: "user.updated", eventId: randomUUID(), user: { id: 9 },
    })).status, 200);
    assert.equal(await count("credit_accounts"), 1);
    assert.equal(await count("credit_transactions"), 1);
    assert.equal((await post(base, "/internal/pubsub/user-events", {
      type: "user.deleted", eventId: randomUUID(), userId: 1,
    })).status, 200);
    assert.equal((await read()).status, 401);
    assert.equal((await post(base, "/internal/pubsub/user-events", {})).status, 400);
    const malformed = await fetch(base + "/internal/pubsub/user-events", { method: "POST", headers, body: "{" });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { code: "INVALID_INPUT" });
  });
});

test("Pub/Sub dispatches credit operations and acknowledges only persisted outcomes", async () => {
  await withCreditApi(async (base) => {
    const endpoint = "/internal/pubsub/credit-commands";
    const missing = await post(base, endpoint, wire());
    assert.equal(missing.status, 503);
    assert.equal(missing.headers.get("retry-after"), "2");
    assert.deepEqual(await missing.json(), { code: "ACCOUNT_PENDING" });
    assert.equal(await count("credit_orders"), 0);
    await createUser(base, 1);
    await createUser(base, 2);
    const reserve = wire();
    assert.equal((await post(base, endpoint, reserve)).status, 204);
    assert.equal((await post(base, endpoint, reserve)).status, 204);
    const recorded = (await pool.query("SELECT result FROM credit_orders WHERE request_id=$1", [reserve.requestId])).rows[0];
    assert.equal(recorded.result.status, "SUCCEEDED");
    assert.equal((await post(base, endpoint, wire("credit.transfer", { orderId: reserve.orderId }))).status, 204);
    const release = wire("credit.release");
    assert.equal((await post(base, endpoint, release)).status, 204);
    const rejected = wire("credit.reserve", { orderId: release.orderId });
    assert.equal((await post(base, endpoint, rejected)).status, 204);
    const rejectedRow = (await pool.query("SELECT result FROM credit_orders WHERE request_id=$1", [rejected.requestId])).rows[0];
    assert.equal(rejectedRow.result.status, "REJECTED");
    assert.equal((await post(base, endpoint, { ...reserve, amount: 121 })).status, 204);
    const conflict = await post(base, endpoint, { ...reserve, orderId: randomUUID() });
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), { code: "IDEMPOTENCY_CONFLICT" });
    const pending = await post(base, endpoint, wire("credit.transfer"));
    assert.equal(pending.status, 503);
    assert.deepEqual(await pending.json(), { code: "RESERVATION_NOT_READY" });
    for (const body of [{}, { message: { data: "bad@@" } }])
      assert.equal((await fetch(base + endpoint, { method: "POST", headers, body: JSON.stringify(body) })).status, 400);
    for (const path of [
      "/internal/v1/credit-reservations",
      `/internal/v1/credit-reservations/${randomUUID()}/release`,
      `/internal/v1/credit-reservations/${randomUUID()}/transfer`,
    ]) assert.equal((await fetch(base + path, { method: "POST", headers, body: "{}" })).status, 404);
    for (const [resource, existingId] of [
      ["credit-orders", reserve.requestId],
      ["credit-reservations", reserve.orderId],
    ])
      for (const id of [existingId, randomUUID(), "bad"])
        for (const requestHeaders of [{}, headers])
          assert.equal((await fetch(base + `/internal/v1/${resource}/${id}`, { headers: requestHeaders })).status, 404);

  });
});

test("HTTP error boundary maps business and dependency failures", async () => {
  const app = express();
  app.get("/:code", (req) => {
    if (req.params.code === "database") throw new Error("database unavailable");
    throw new CreditError(req.params.code);
  });
  app.use(errorHandler);
  await withServer(app, async (base) => {
    for (const [status, code] of [
      [503, "ACCOUNT_PENDING"], [503, "RESERVATION_NOT_READY"],
      [409, "IDEMPOTENCY_CONFLICT"], [400, "INVALID_INPUT"],
      [400, "INVALID_COMMAND"], [400, "INVALID_EVENT"],
      [401, "UNAUTHORIZED"], [401, "USER_INACTIVE"],
      [503, "database"],
    ]) {
      const res = await fetch(base + "/" + code);
      assert.equal(res.status, status);
      assert.deepEqual(await res.json(), { code: code === "database" ? "DEPENDENCY_UNAVAILABLE" : code });
      assert.equal(res.headers.get("retry-after"), status === 503 ? "2" : null);
    }
  });
});
test("Pub/Sub push authentication rejects diagnostic identities on alternate URLs", async () => {
  const { OAuth2Client } = await import("google-auth-library");
  const originalVerify = OAuth2Client.prototype.verifyIdToken;
  const settings = {
    internalAudience: config.internalAudience,
    pushInvokerEmail: config.pushInvokerEmail,
    internalSharedSecret: config.internalSharedSecret,
  };
  config.internalAudience = "credit-test-audience";
  config.pushInvokerEmail = "pubsub@example.test";
  config.internalSharedSecret = undefined;
  OAuth2Client.prototype.verifyIdToken = async ({ idToken }) => ({
    getPayload: () => ({
      email:
        idToken === "push-token"
          ? "pubsub@example.test"
          : "diagnostic@example.test",
      email_verified: true,
    }),
  });
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, token) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(envelope(
        path.toLowerCase().includes("user-events")
          ? { type: "user.created", eventId: randomUUID(), user: { id: 1 } }
          : wire(),
      )),
    });
  try {
    for (const path of [
      "/internal/pubsub/credit-commands",
      "/internal/pubsub/credit-commands/",
      "/INTERNAL/PUBSUB/CREDIT-COMMANDS",
      "/internal/pubsub/user-events",
      "/internal/pubsub/user-events/",
      "/INTERNAL/PUBSUB/USER-EVENTS",
    ])
      assert.equal((await post(path, "diagnostic-token")).status, 401, path);
    assert.equal(await count("credit_accounts"), 0);
    assert.equal(
      (await post("/internal/pubsub/credit-commands/", "push-token")).status,
      503,
    );
    assert.equal(
      (await post("/INTERNAL/PUBSUB/USER-EVENTS", "push-token")).status,
      200,
    );
    assert.equal(await count("credit_accounts"), 1);
  } finally {
    OAuth2Client.prototype.verifyIdToken = originalVerify;
    Object.assign(config, settings);
    await new Promise((resolve) => server.close(resolve));
  }
});
