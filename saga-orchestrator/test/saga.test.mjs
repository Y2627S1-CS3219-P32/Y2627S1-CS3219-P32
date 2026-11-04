/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
 * Scope: Integration tests for the saga orchestrator: reserve then open or reject,
 * timeouts, cancellations and expiry releasing credits, completion transferring and
 * settling, duplicates, and the commands it publishes. Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-18: published before responding. Author review: Pending.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { after, before, beforeEach, test } from "node:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("Set TEST_DATABASE_URL to a PostgreSQL connection with permission to create a disposable test database.");
}

const SECRET = randomBytes(32).toString("hex");
const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
const databaseName = `saga_test_${randomBytes(8).toString("hex")}`;
let createdDatabase = false;
let server, baseUrl, pool, outbox, abortOverdueReservations;
let published = [];

function push(path, message) {
  return fetch(`${baseUrl}/internal/pubsub/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": SECRET },
    body: JSON.stringify({ message: { data: Buffer.from(JSON.stringify(message)).toString("base64") } }),
  });
}

async function orderEvent(type, orderId, order = {}, eventId = randomUUID()) {
  const response = await push("order-events", {
    eventId, type, orderId, sequence: 1, state: "X",
    order: { id: orderId, requesterId: 1, courierId: null, creditReward: 50, ...order },
  });
  assert.equal(response.status, 204);
  await outbox.outboxIdle();
}

async function creditResult(command, status = "SUCCEEDED", code = "OK", eventId = randomUUID()) {
  const type = status === "REJECTED"
    ? (command.type === "credit.reserve" ? "credit.reservation_rejected" : "credit.order_rejected")
    : { "credit.reserve": "credit.reserved", "credit.release": "credit.released", "credit.transfer": "credit.transferred" }[command.type];
  const response = await push("credit-events", {
    eventId, type, occurredAt: new Date().toISOString(),
    requestId: command.requestId, correlationId: command.correlationId, orderId: command.orderId,
    data: { requestId: command.requestId, status, code, orderId: command.orderId },
  });
  assert.equal(response.status, 204);
  await outbox.outboxIdle();
}

const sent = (orderId) => published.filter((item) => item.orderingKey === orderId);
const lastCredit = (orderId) => sent(orderId).filter((item) => item.topic === "credit-commands").at(-1)?.data;
const orderCommands = (orderId) => sent(orderId).filter((item) => item.topic === "order-commands").map((item) => item.data.type);
const saga = async (orderId) => (await pool.query("select * from sagas where order_id = $1", [orderId])).rows[0];

before(async () => {
  await admin.connect();
  await admin.query(`create database "${databaseName}"`);
  createdDatabase = true;
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  process.env.DATABASE_URL = url.href;
  process.env.INTERNAL_SHARED_SECRET = SECRET;
  delete process.env.PUBSUB_EMULATOR_HOST;

  const dbModule = await import("../dist/db/index.js");
  pool = dbModule.pool;
  await migrate(dbModule.db, { migrationsFolder: "./drizzle" });
  (await import("../dist/pubsub.js")).setPublisher(async (topic, data, orderingKey, attributes) => {
    published.push({ topic, data, orderingKey, attributes });
  });
  outbox = await import("../dist/outbox.js");
  ({ abortOverdueReservations } = await import("../dist/saga.js"));
  const { app } = await import("../dist/app.js");
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  published = [];
});

after(async () => {
  server?.close();
  await outbox?.outboxIdle();
  await pool?.end();
  if (createdDatabase) await admin.query(`drop database "${databaseName}" with (force)`);
  await admin.end();
});

test("internal routes need the internal secret", async () => {
  const response = await fetch(`${baseUrl}/internal/outbox/publish`, { method: "POST" });
  assert.equal(response.status, 401);
});

test("happy path: reserve → OpenOrder, complete → transfer → SettleOrder", async () => {
  const orderId = randomUUID();
  await orderEvent("order.created", orderId, { requesterId: 7, creditReward: 120 });

  const reserve = lastCredit(orderId);
  assert.equal(reserve.type, "credit.reserve");
  assert.equal(reserve.requesterId, 7);
  assert.equal(reserve.amount, 120);
  assert.equal(reserve.orderId, orderId);
  const credit = sent(orderId).find((item) => item.topic === "credit-commands");
  assert.deepEqual(credit.attributes, { type: "credit.reserve" });
  assert.equal((await saga(orderId)).state, "RESERVING");

  await creditResult(reserve);
  assert.deepEqual(orderCommands(orderId), ["OpenOrder"]);
  const open = sent(orderId).find((item) => item.data.type === "OpenOrder").data;
  assert.equal(open.orderId, orderId);
  assert.match(open.commandId, /^[0-9a-f-]{36}$/);
  assert.equal((await saga(orderId)).state, "OPEN");

  await orderEvent("order.completed", orderId, { requesterId: 7, courierId: 9, creditReward: 120 });
  const transfer = lastCredit(orderId);
  assert.equal(transfer.type, "credit.transfer");
  assert.equal(transfer.courierId, 9);
  assert.equal(transfer.correlationId, reserve.correlationId);

  await creditResult(transfer);
  assert.deepEqual(orderCommands(orderId), ["OpenOrder", "SettleOrder"]);
  const row = await saga(orderId);
  assert.equal(row.state, "SETTLED");
  assert.equal(row.courier_id, 9);
});

test("a rejected reservation rejects the order", async () => {
  const orderId = randomUUID();
  await orderEvent("order.created", orderId);
  await creditResult(lastCredit(orderId), "REJECTED", "INSUFFICIENT_CREDITS");
  assert.deepEqual(orderCommands(orderId), ["RejectOrder"]);
  const row = await saga(orderId);
  assert.equal(row.state, "REJECTED");
  assert.equal(row.failure_code, "INSUFFICIENT_CREDITS");
});

test("redelivered events and results change nothing", async () => {
  const orderId = randomUUID();
  const eventId = randomUUID();
  await orderEvent("order.created", orderId, {}, eventId);
  await orderEvent("order.created", orderId, {}, eventId);
  await orderEvent("order.created", orderId); // a different event for an existing saga
  assert.equal(sent(orderId).filter((item) => item.topic === "credit-commands").length, 1);

  const reserve = lastCredit(orderId);
  const resultId = randomUUID();
  await creditResult(reserve, "SUCCEEDED", "OK", resultId);
  await creditResult(reserve, "SUCCEEDED", "OK", resultId);
  await creditResult(reserve); // credit.order_succeeded for a repeated command
  assert.deepEqual(orderCommands(orderId), ["OpenOrder"]);
});

test("no answer in time: abort the order and release, ignoring a late reserve", async () => {
  const orderId = randomUUID();
  await orderEvent("order.created", orderId, { requesterId: 3, creditReward: 40 });
  const reserve = lastCredit(orderId);
  await pool.query("update sagas set reserve_deadline = now() - interval '1 second' where order_id = $1", [orderId]);

  const sweep = await fetch(`${baseUrl}/internal/sagas/abort-overdue`, { method: "POST", headers: { "x-internal-secret": SECRET } });
  assert.ok((await sweep.json()).aborted >= 1);
  await outbox.outboxIdle();
  assert.deepEqual(orderCommands(orderId), ["AbortOrder"]);
  const releaseCommand = lastCredit(orderId);
  assert.deepEqual(
    { type: releaseCommand.type, requesterId: releaseCommand.requesterId, amount: releaseCommand.amount, reason: releaseCommand.reason },
    { type: "credit.release", requesterId: 3, amount: 40, reason: "Credit reservation timed out" },
  );
  assert.equal((await saga(orderId)).state, "ABORTED");

  await creditResult(reserve); // the reserve went through late: the release covers it
  assert.deepEqual(orderCommands(orderId), ["AbortOrder"]);
  await creditResult(releaseCommand);
  assert.equal((await saga(orderId)).state, "RELEASED");
  assert.equal(await abortOverdueReservations(), 0);
});

test("cancelled or expired orders release their credits", async () => {
  const open = randomUUID();
  await orderEvent("order.created", open);
  await creditResult(lastCredit(open));
  await orderEvent("order.cancelled", open);
  const cancelRelease = lastCredit(open);
  assert.equal(cancelRelease.type, "credit.release");
  assert.equal(cancelRelease.reason, "Order cancelled");
  await creditResult(cancelRelease);
  assert.equal((await saga(open)).state, "RELEASED");

  const expired = randomUUID();
  await orderEvent("order.created", expired);
  await creditResult(lastCredit(expired));
  await orderEvent("order.expired", expired);
  assert.equal(lastCredit(expired).reason, "Order expired");

  // Cancelled while credit was still reserving: release now, ignore the reserve result.
  const pending = randomUUID();
  await orderEvent("order.created", pending);
  const reserve = lastCredit(pending);
  await orderEvent("order.cancelled", pending);
  assert.equal((await saga(pending)).state, "RELEASING");
  await creditResult(reserve);
  assert.deepEqual(orderCommands(pending), []);

  // Cancelling again, or after release, does nothing.
  const releases = sent(open).filter((item) => item.topic === "credit-commands").length;
  await orderEvent("order.cancelled", open);
  assert.equal(sent(open).filter((item) => item.topic === "credit-commands").length, releases);
});

test("a rejected transfer or release marks the saga failed", async () => {
  const orderId = randomUUID();
  await orderEvent("order.created", orderId);
  await creditResult(lastCredit(orderId));
  await orderEvent("order.completed", orderId, { courierId: 1 });
  await creditResult(lastCredit(orderId), "REJECTED", "SELF_TRANSFER");
  const row = await saga(orderId);
  assert.equal(row.state, "FAILED");
  assert.equal(row.failure_code, "SELF_TRANSFER");
  assert.deepEqual(orderCommands(orderId), ["OpenOrder"]);
});

test("unrelated, unknown and malformed messages are acknowledged without changes", async () => {
  const orderId = randomUUID();
  await orderEvent("order.opened", orderId); // not a saga trigger
  await orderEvent("order.completed", orderId); // no saga for this order
  const allocated = await push("credit-events", { eventId: randomUUID(), type: "credit.account_allocated", requestId: randomUUID(), data: { status: "SUCCEEDED" } });
  assert.equal(allocated.status, 204);
  const garbage = await push("credit-events", { eventId: "nope", orderId: randomUUID(), data: {} });
  assert.equal(garbage.status, 204);
  const unknown = await push("credit-events", { eventId: randomUUID(), orderId, requestId: randomUUID(), data: { status: "SUCCEEDED" } });
  assert.equal(unknown.status, 204);
  assert.deepEqual(published, []);
  assert.equal(await saga(orderId), undefined);
});

test("commands are published before the push is acknowledged", async () => {
  // No waiting on the relay: Cloud Run throttles CPU once the response has gone.
  const orderId = randomUUID();
  const response = await push("order-events", {
    eventId: randomUUID(), type: "order.created", orderId,
    order: { id: orderId, requesterId: 1, courierId: null, creditReward: 5 },
  });
  assert.equal(response.status, 204);
  assert.equal(lastCredit(orderId)?.type, "credit.reserve");
});
