/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: Tap supervisor against an in-memory broker: one own subscription per topic,
 * never another consumer's, every delivery acknowledged, bounded retries, recovery
 * after the emulator loses subscriptions, and read-only remote mode. Author review: Pending.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../dist/config.js";
import { EventStore } from "../dist/store.js";
import { Tap } from "../dist/tap.js";

class FakeBroker {
  topics = new Set();
  subscriptions = new Map(); // name -> { topic, push }
  opened = new Map(); // name -> listener
  calls = [];
  listError = undefined;
  createError = undefined;

  async listTopics() {
    this.calls.push(["listTopics"]);
    if (this.listError) throw this.listError;
    return [...this.topics];
  }
  async createSubscription(topic, name) {
    this.calls.push(["create", topic, name]);
    if (this.createError) throw this.createError;
    if (this.subscriptions.has(name)) throw Object.assign(new Error("6 ALREADY_EXISTS"), { code: 6 });
    this.subscriptions.set(name, { topic, push: false });
  }
  async getSubscription(name) {
    this.calls.push(["get", name]);
    return this.subscriptions.get(name) ?? null;
  }
  open(name, listener) {
    this.calls.push(["open", name]);
    this.opened.set(name, listener);
    return { close: async () => { this.calls.push(["closeHandle", name]); this.opened.delete(name); } };
  }
  async deleteSubscription(name) {
    this.calls.push(["delete", name]);
    this.subscriptions.delete(name);
  }
  async close() {
    this.calls.push(["closeBroker"]);
  }
  deliver(name, data, extra = {}) {
    const acks = { count: 0 };
    this.opened.get(name).message({
      id: extra.id ?? `m-${Math.random()}`, data: Buffer.from(typeof data === "string" ? data : JSON.stringify(data)),
      attributes: extra.attributes ?? {}, orderingKey: "", publishTime: new Date(), deliveryAttempt: 0,
      ack: () => { acks.count++; },
    });
    return acks;
  }
  namesFor(kind) {
    return this.calls.filter((call) => call[0] === kind).map((call) => call.at(-1));
  }
}

class FakeScheduler {
  tasks = [];
  schedule = (fn, ms) => {
    const task = { fn, ms, cancelled: false };
    this.tasks.push(task);
    return () => { task.cancelled = true; };
  };
  pending() {
    return this.tasks.filter((task) => !task.cancelled);
  }
  async runAll(predicate = () => true) {
    const due = this.pending().filter(predicate);
    for (const task of due) task.cancelled = true;
    for (const task of due) await task.fn();
  }
}

const emulatorConfig = (extra = {}) => loadConfig({ PUBSUB_EMULATOR_HOST: "127.0.0.1:8085", ...extra });

function setup(config = emulatorConfig()) {
  const broker = new FakeBroker();
  const scheduler = new FakeScheduler();
  const store = new EventStore(config.maxEvents);
  const tap = new Tap({ config, broker, store, instanceId: "abc123", schedule: scheduler.schedule });
  return { broker, scheduler, store, tap };
}

const topicStatus = (tap, topic) => tap.status().topics.find((entry) => entry.topic === topic);

test("one own subscription per existing topic, including topics outside the expected six", async () => {
  const { broker, tap } = setup();
  broker.topics = new Set(["user-events", "order-events", "extra-topic"]);
  broker.subscriptions.set("user-events-worker", { topic: "user-events", push: true });
  await tap.discover();
  const created = broker.calls.filter((call) => call[0] === "create").map((call) => [call[1], call[2]]);
  assert.deepEqual(created.sort(), [
    ["extra-topic", "event-bus-tap-abc123-extra-topic"],
    ["order-events", "event-bus-tap-abc123-order-events"],
    ["user-events", "event-bus-tap-abc123-user-events"],
  ]);
  for (const name of broker.namesFor("open")) assert.match(name, /^event-bus-tap-abc123-/);
  assert.ok(!broker.namesFor("open").includes("user-events-worker"));
  assert.equal(topicStatus(tap, "user-events").state, "ready");
  assert.equal(topicStatus(tap, "extra-topic").expected, false);
  for (const topic of ["supplier-events", "order-commands", "credit-commands", "credit-events"]) {
    assert.equal(topicStatus(tap, topic).state, "missing", topic);
  }
  assert.equal(tap.status().broker.state, "connected");
});

test("topics created after start are picked up by the next discovery", async () => {
  const { broker, tap } = setup();
  broker.topics = new Set(["user-events"]);
  await tap.discover();
  assert.equal(topicStatus(tap, "credit-events").state, "missing");
  broker.topics.add("credit-events");
  await tap.discover();
  assert.equal(topicStatus(tap, "credit-events").state, "ready");
  assert.equal(broker.namesFor("create").filter((name) => name.endsWith("user-events")).length, 1, "no second subscription");
});

test("every delivery is captured and acknowledged exactly once, malformed ones too", async () => {
  const { broker, tap, store } = setup();
  broker.topics = new Set(["user-events", "order-events"]);
  const seen = [];
  tap.on("event", (event) => seen.push(event.topic));
  await tap.discover();
  const a = broker.deliver("event-bus-tap-abc123-user-events", { type: "user.created", user: { id: 1 } });
  const b = broker.deliver("event-bus-tap-abc123-order-events", { type: "order.created" }, { attributes: { type: "order.created" } });
  const c = broker.deliver("event-bus-tap-abc123-order-events", "{not json");
  assert.deepEqual([a.count, b.count, c.count], [1, 1, 1]);
  assert.deepEqual(seen, ["user-events", "order-events", "order-events"]);
  assert.equal(store.size, 3);
  assert.equal(topicStatus(tap, "order-events").captured, 2);
  assert.ok(topicStatus(tap, "order-events").lastMessageAt);
});

test("an existing subscription with the tap's name is never joined", async () => {
  const { broker, tap } = setup();
  broker.topics = new Set(["order-events"]);
  broker.subscriptions.set("event-bus-tap-abc123-order-events", { topic: "order-events", push: false });
  await tap.discover();
  assert.equal(topicStatus(tap, "order-events").state, "error");
  assert.match(topicStatus(tap, "order-events").lastError, /already exists/);
  assert.deepEqual(broker.namesFor("open"), []);
});

test("stream errors are retried with capped exponential backoff", async () => {
  const { broker, tap, scheduler } = setup();
  broker.topics = new Set(["order-events"]);
  await tap.discover();
  const name = "event-bus-tap-abc123-order-events";
  const delays = [];
  for (let i = 0; i < 8; i++) {
    broker.opened.get(name).error(new Error("14 UNAVAILABLE"));
    assert.equal(topicStatus(tap, "order-events").state, "retrying");
    const retry = scheduler.pending().filter((task) => task.ms !== tap.discoveryIntervalMs);
    assert.equal(retry.length, 1, "exactly one retry scheduled");
    delays.push(retry[0].ms);
    await scheduler.runAll((task) => task === retry[0]);
    assert.equal(topicStatus(tap, "order-events").state, "ready");
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  // Reopened the same own subscription; never created a second one.
  assert.equal(broker.namesFor("create").length, 1);
  // A received message resets the backoff.
  broker.deliver(name, { type: "x" });
  broker.opened.get(name).error(new Error("14 UNAVAILABLE"));
  assert.equal(scheduler.pending().find((task) => task.ms !== tap.discoveryIntervalMs).ms, 1000);
});

test("a subscription lost by an emulator restart is recreated and the gap is reported", async () => {
  const { broker, tap } = setup();
  broker.topics = new Set(["order-events"]);
  await tap.discover();
  broker.subscriptions.clear();
  await tap.discover();
  const status = topicStatus(tap, "order-events");
  assert.equal(status.state, "ready");
  assert.equal(status.resubscriptions, 1);
  assert.ok(status.subscribedSince);
  assert.equal(broker.namesFor("create").length, 2);
});

test("a topic deleted while its subscription is retrying stops retrying", async () => {
  const { broker, tap, scheduler } = setup();
  broker.topics = new Set(["order-events"]);
  await tap.discover();
  broker.opened.get("event-bus-tap-abc123-order-events").error(new Error("5 NOT_FOUND"));
  assert.equal(topicStatus(tap, "order-events").state, "retrying");
  broker.topics.clear();
  await tap.discover();
  assert.equal(topicStatus(tap, "order-events").state, "missing");
  assert.equal(scheduler.pending().length, 0, "no retry left behind");
});

test("an unreachable broker is reported, not fatal", async () => {
  const { broker, tap } = setup();
  broker.listError = new Error("14 UNAVAILABLE: connect ECONNREFUSED http://x/?token=supersecretvalue");
  await tap.discover();
  const status = tap.status();
  assert.equal(status.broker.state, "unreachable");
  assert.ok(!status.broker.lastError.includes("supersecretvalue"));
  broker.listError = undefined;
  broker.topics = new Set(["order-events"]);
  await tap.discover();
  assert.equal(tap.status().broker.state, "connected");
});

test("discovery keeps running on its interval and stops on shutdown", async () => {
  const { broker, tap, scheduler } = setup();
  broker.topics = new Set(["order-events"]);
  await tap.start();
  assert.equal(scheduler.pending().filter((task) => task.ms === tap.discoveryIntervalMs).length, 1);
  await scheduler.runAll();
  assert.equal(scheduler.pending().filter((task) => task.ms === tap.discoveryIntervalMs).length, 1);
  await tap.stop();
  assert.equal(scheduler.pending().length, 0);
});

test("shutdown deletes only the tap's own subscriptions", async () => {
  const { broker, tap } = setup();
  broker.topics = new Set(["user-events", "order-events"]);
  broker.subscriptions.set("user-events-worker", { topic: "user-events", push: true });
  await tap.discover();
  await tap.stop();
  assert.deepEqual(broker.namesFor("delete").sort(), ["event-bus-tap-abc123-order-events", "event-bus-tap-abc123-user-events"]);
  assert.ok(broker.subscriptions.has("user-events-worker"));
  assert.deepEqual(broker.calls.at(-1), ["closeBroker"]);
});

const remoteConfig = () => loadConfig({
  TAP_MODE: "remote", PUBSUB_PROJECT_ID: "p",
  TAP_REMOTE_SUBSCRIPTIONS: "order-events=event-bus-tap-order-events,user-events=event-bus-tap-user-events,credit-events=event-bus-tap-credit-events",
});

test("remote mode only reads pre-created pull tap subscriptions and never changes the broker", async () => {
  const { broker, tap } = setup(remoteConfig());
  broker.subscriptions.set("event-bus-tap-order-events", { topic: "order-events", push: false });
  broker.subscriptions.set("event-bus-tap-user-events", { topic: "credit-events", push: false });
  broker.subscriptions.set("event-bus-tap-credit-events", { topic: "credit-events", push: true });
  await tap.discover();
  assert.deepEqual(broker.namesFor("open"), ["event-bus-tap-order-events"]);
  assert.match(topicStatus(tap, "user-events").lastError, /belongs to topic credit-events/);
  assert.match(topicStatus(tap, "credit-events").lastError, /push/);
  assert.equal(topicStatus(tap, "supplier-events").state, "missing");
  await tap.stop();
  for (const kind of ["listTopics", "create", "delete"]) {
    assert.equal(broker.calls.filter((call) => call[0] === kind).length, 0, kind);
  }
});
