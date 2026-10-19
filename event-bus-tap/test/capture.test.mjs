/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: Turning a received Pub/Sub message into a redacted, displayable record.
 * Author review: Pending.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { toCapturedEvent } from "../dist/capture.js";

const NOW = new Date("2026-10-19T03:15:23.000Z");
const HASH = "scrypt$00ff$" + "cd".repeat(64);

function message(data, extra = {}) {
  return {
    id: "m-1",
    data: Buffer.from(typeof data === "string" ? data : JSON.stringify(data)),
    attributes: {},
    orderingKey: "",
    publishTime: new Date("2026-10-19T03:15:22.481Z"),
    deliveryAttempt: 0,
    ...extra,
  };
}

test("a user event without attributes takes its type and ids from the payload, redacted", () => {
  const event = toCapturedEvent("user-events", "event-bus-tap-x-user-events", message({
    type: "user.created",
    user: { id: 7, name: "Ada Tan", displayName: "ada", email: "ada.tan@u.nus.edu", role: "student", passwordHash: HASH },
    eventId: "e-1", version: 42,
  }, { orderingKey: "7" }), NOW, 65536);
  assert.equal(event.type, "user.created");
  assert.equal(event.kind, "event");
  assert.equal(event.payloadStatus, "json");
  assert.deepEqual(event.ids, { eventId: "e-1", userId: 7, version: 42 });
  assert.equal(event.orderingKey, "7");
  assert.equal(event.publishTime, "2026-10-19T03:15:22.481Z");
  assert.equal(event.receivedAt, NOW.toISOString());
  const json = JSON.stringify(event);
  assert.ok(!json.includes("scrypt$") && !json.includes("ada.tan"));
});

test("order events carry ids from attributes and payload", () => {
  const event = toCapturedEvent("order-events", "s", message({
    eventId: "e-2", type: "order.created", orderId: "o-1", sequence: 1, state: "PENDING", actorId: 7, commandId: null,
    order: { id: "o-1", requesterId: 7, supplierId: "s-1" },
  }, { attributes: { type: "order.created", orderId: "o-1" }, orderingKey: "o-1" }), NOW, 65536);
  assert.equal(event.type, "order.created");
  assert.deepEqual(event.ids, { eventId: "e-2", orderId: "o-1", sequence: 1, supplierId: "s-1" });
  assert.deepEqual(event.attributes, { type: "order.created", orderId: "o-1" });
});

test("commands are labelled as commands and keep correlation ids", () => {
  const event = toCapturedEvent("credit-commands", "s", message(
    { type: "credit.reserve", requestId: "r-1", correlationId: "c-1", orderId: "o-1", requesterId: 7, amount: 12 },
    { attributes: { type: "credit.reserve" } },
  ), NOW, 65536);
  assert.equal(event.kind, "command");
  assert.deepEqual(event.ids, { orderId: "o-1", correlationId: "c-1", requestId: "r-1" });
  const order = toCapturedEvent("order-commands", "s", message({ commandId: "k-1", type: "OpenOrder", orderId: "o-1" }), NOW, 65536);
  assert.equal(order.kind, "command");
  assert.equal(order.type, "OpenOrder");
  assert.deepEqual(order.ids, { orderId: "o-1", commandId: "k-1" });
});

test("non-JSON data is not shown at all, so free text cannot leak", () => {
  const event = toCapturedEvent("order-events", "s", message("password=hunter2 not json"), NOW, 65536);
  assert.equal(event.payloadStatus, "not-json");
  assert.equal(event.payload, null);
  assert.equal(event.type, null);
  assert.ok(!JSON.stringify(event).includes("hunter2"));
});

test("payloads over the size limit are not parsed or kept", () => {
  const event = toCapturedEvent("order-events", "s", message({ type: "big", blob: "x".repeat(2000) }), NOW, 1000);
  assert.equal(event.payloadStatus, "too-large");
  assert.equal(event.payload, null);
  assert.ok(event.sizeBytes > 1000);
});

test("empty data is reported as empty", () => {
  const event = toCapturedEvent("order-events", "s", message(""), NOW, 1000);
  assert.equal(event.payloadStatus, "empty");
});

test("attributes and ordering keys are redacted too", () => {
  const event = toCapturedEvent("order-events", "s", message({ type: "x" }, {
    attributes: { type: "x", token: "abc", note: "Bearer eyJa.eyJb.c" }, orderingKey: "ada@u.nus.edu",
  }), NOW, 1000);
  assert.equal(event.attributes.token, "[redacted]");
  assert.ok(!event.attributes.note.includes("eyJa"));
  assert.equal(event.orderingKey, "a***@u.nus.edu");
});

test("a type that is not a string is not used as the type", () => {
  const event = toCapturedEvent("order-events", "s", message({ type: { evil: true } }), NOW, 1000);
  assert.equal(event.type, null);
});

test("delivery attempt is kept when the transport reports it", () => {
  assert.equal(toCapturedEvent("t", "s", message({}, { deliveryAttempt: 3 }), NOW, 1000).deliveryAttempt, 3);
  assert.equal(toCapturedEvent("t", "s", message({}, { deliveryAttempt: 0 }), NOW, 1000).deliveryAttempt, null);
});
