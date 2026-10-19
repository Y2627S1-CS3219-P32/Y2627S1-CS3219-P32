/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: Bounded in-memory retention and duplicate labelling in the tap's event store.
 * Author review: Pending.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { EventStore } from "../dist/store.js";

function captured(topic, messageId, ids = {}) {
  return {
    topic, kind: "event", subscription: `event-bus-tap-x-${topic}`, messageId, publishTime: null,
    receivedAt: "2026-10-19T00:00:00.000Z", orderingKey: "", deliveryAttempt: null, attributes: {},
    type: "t", ids, sizeBytes: 2, payloadStatus: "json", payload: {},
  };
}

test("retention is bounded and the oldest events are evicted first", () => {
  const store = new EventStore(3);
  for (let i = 1; i <= 5; i++) store.add(captured(i % 2 ? "order-events" : "user-events", `m-${i}`));
  assert.deepEqual(store.list().map((event) => event.seq), [3, 4, 5]);
  assert.equal(store.evicted, 2);
  assert.equal(store.size, 3);
  assert.deepEqual(store.capturedByTopic(), { "order-events": 3, "user-events": 2 });
});

test("a redelivery of the same message is kept and labelled", () => {
  const store = new EventStore(10);
  const first = store.add(captured("order-events", "m-1"));
  const again = store.add(captured("order-events", "m-1"));
  assert.equal(store.size, 2);
  assert.equal(first.redeliveryOf, undefined);
  assert.equal(again.redeliveryOf, first.seq);
});

test("the same message id on another topic is not a redelivery", () => {
  const store = new EventStore(10);
  store.add(captured("order-events", "m-1"));
  assert.equal(store.add(captured("user-events", "m-1")).redeliveryOf, undefined);
});

test("a republished message (new message id, same event id) is labelled", () => {
  const store = new EventStore(10);
  const first = store.add(captured("order-events", "m-1", { eventId: "e-1" }));
  const republished = store.add(captured("order-events", "m-2", { eventId: "e-1" }));
  assert.equal(republished.redeliveryOf, undefined);
  assert.deepEqual(republished.sameIdAs, { seq: first.seq, key: "eventId e-1" });
  const command = store.add(captured("credit-commands", "m-3", { requestId: "r-1" }));
  const commandAgain = store.add(captured("credit-commands", "m-4", { requestId: "r-1" }));
  assert.equal(command.sameIdAs, undefined);
  assert.deepEqual(commandAgain.sameIdAs, { seq: command.seq, key: "requestId r-1" });
});

test("duplicate indexes shrink with eviction, so memory stays bounded", () => {
  const store = new EventStore(5);
  for (let i = 0; i < 1000; i++) store.add(captured("order-events", `m-${i}`, { eventId: `e-${i}` }));
  assert.ok(store.indexSize() <= 10, `index size ${store.indexSize()}`);
  // An evicted message is no longer recognised as seen before.
  assert.equal(store.add(captured("order-events", "m-0")).redeliveryOf, undefined);
});

test("listing returns copies that callers cannot use to change the store", () => {
  const store = new EventStore(5);
  store.add(captured("order-events", "m-1"));
  store.list().pop();
  assert.equal(store.size, 1);
});

test("the store rejects nonsensical capacities", () => {
  assert.throws(() => new EventStore(0));
  assert.throws(() => new EventStore(1.5));
});
