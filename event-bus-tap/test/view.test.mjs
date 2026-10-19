/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: Browser view model: the topic filter changes only what is shown, never what
 * has been captured. Author review: Pending.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { addEvent, applySnapshot, countByTopic, createViewState, eventIds, topicKind, topicStateView, visibleEvents } from "../public/view.js";

function event(seq, topic, extra = {}) {
  return { seq, topic, type: "t", ids: {}, receivedAt: "2026-10-19T00:00:00.000Z", ...extra };
}

test("topics are classified as commands or events by their name", () => {
  assert.equal(topicKind("credit-commands"), "command");
  assert.equal(topicKind("order-commands"), "command");
  assert.equal(topicKind("order-events"), "event");
  assert.equal(topicKind("something-else"), "message");
});

test("the filter shows only selected topics, newest first, without dropping the rest", () => {
  const state = createViewState(100);
  addEvent(state, event(1, "user-events"));
  addEvent(state, event(2, "order-events"));
  addEvent(state, event(3, "user-events"));
  const onlyOrders = visibleEvents(state, new Set(["order-events"]));
  assert.deepEqual(onlyOrders.map((e) => e.seq), [2]);
  // Switching the filter shows the already captured user events again.
  assert.deepEqual(visibleEvents(state, new Set(["user-events"])).map((e) => e.seq), [3, 1]);
  assert.deepEqual(visibleEvents(state, new Set(["user-events", "order-events"])).map((e) => e.seq), [3, 2, 1]);
  assert.deepEqual(visibleEvents(state, new Set()).map((e) => e.seq), []);
  assert.equal(state.events.length, 3);
  assert.deepEqual(Object.fromEntries(countByTopic(state.events)), { "user-events": 2, "order-events": 1 });
});

test("clearing the view hides earlier events but keeps capturing", () => {
  const state = createViewState(100);
  addEvent(state, event(1, "user-events"));
  addEvent(state, event(2, "user-events"));
  const clearedThroughSeq = 2;
  addEvent(state, event(3, "user-events"));
  assert.deepEqual(visibleEvents(state, new Set(["user-events"]), clearedThroughSeq).map((e) => e.seq), [3]);
});

test("the client copy is bounded and ignores events it already has", () => {
  const state = createViewState(3);
  for (let seq = 1; seq <= 5; seq++) addEvent(state, event(seq, "order-events"));
  assert.deepEqual(state.events.map((e) => e.seq), [3, 4, 5]);
  assert.equal(addEvent(state, event(4, "order-events")), false);
  assert.equal(state.events.length, 3);
});

test("a snapshot replaces the client copy, including after a tap restart", () => {
  const state = createViewState(3);
  addEvent(state, event(9, "order-events"));
  applySnapshot(state, { instanceId: "b", events: [event(1, "user-events"), event(2, "order-events"), event(3, "order-events"), event(4, "user-events")] });
  assert.equal(state.instanceId, "b");
  assert.deepEqual(state.events.map((e) => e.seq), [2, 3, 4]);
  assert.equal(addEvent(state, event(5, "user-events")), true);
});

test("ids are listed in a fixed order with the ordering key last", () => {
  const ids = eventIds(event(1, "credit-events", {
    ids: { requestId: "r", correlationId: "c", orderId: "o", eventId: "e" }, orderingKey: "o",
  }));
  assert.deepEqual(ids, [["orderId", "o"], ["correlationId", "c"], ["requestId", "r"], ["eventId", "e"], ["orderingKey", "o"]]);
});

// Repair T2 (self-tested): the first snapshot uses the tap's TAP_MAX_EVENTS, not the default 1000.
test("the first snapshot keeps the tap's whole buffer when TAP_MAX_EVENTS is above 1000", () => {
  const state = createViewState(1000);
  const events = Array.from({ length: 1301 }, (_, i) => event(i + 1, i % 2 ? "user-events" : "order-events"));
  applySnapshot(state, { instanceId: "i", events, status: { store: { size: 1301, max: 1500, evicted: 0 } } });
  assert.equal(state.maxEvents, 1500);
  assert.equal(state.events.length, 1301);
  assert.equal(state.lastSeq, 1301);
  // A smaller limit still trims.
  applySnapshot(state, { instanceId: "j", events, status: { store: { size: 1301, max: 100, evicted: 0 } } });
  assert.deepEqual([state.events.length, state.events[0].seq], [100, 1202]);
});

// Repair T1 (self-tested): no green "listening" while the broker is unreachable.
test("topic state labels never claim listening without a connected broker", () => {
  const unreachable = { text: "unknown", className: "state-unknown", title: "Broker unreachable: not known whether this topic is being read" };
  const notYet = { text: "unknown", className: "state-unknown", title: "Broker has not answered yet" };
  assert.deepEqual(topicStateView({ state: "ready", subscription: "event-bus-tap-a-user-events" }, "connected"),
    { text: "listening", className: "state-ready", title: "event-bus-tap-a-user-events" });
  assert.deepEqual(topicStateView({ state: "ready", subscription: "s" }, "unreachable"), unreachable);
  assert.deepEqual(topicStateView({ state: "missing" }, "unreachable"), unreachable);
  assert.deepEqual(topicStateView({ state: "ready" }, "connecting"), notYet);
  assert.deepEqual(topicStateView({ state: "missing" }, undefined), notYet);
  assert.equal(topicStateView({ state: "missing" }, "connected").text, "not created yet");
  // States that already report a problem keep their own label and error.
  assert.deepEqual(topicStateView({ state: "retrying", retryInMs: 4000, lastError: "14 UNAVAILABLE" }, "unreachable"),
    { text: "retrying in 4 s", className: "state-retrying", title: "14 UNAVAILABLE" });
  assert.equal(topicStateView({ state: "error" }, "unreachable").className, "state-error");
});
