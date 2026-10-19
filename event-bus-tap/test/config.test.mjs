/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: Safe configuration defaults: emulator only unless remote mode is chosen
 * explicitly, and remote mode only reads named tap subscriptions. Author review: Pending.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { APPLICATION_TOPICS, isTapSubscriptionName, loadConfig } from "../dist/config.js";

test("the default is the emulator, and it refuses to start without an emulator host", () => {
  assert.throws(() => loadConfig({}), /PUBSUB_EMULATOR_HOST/);
  const config = loadConfig({ PUBSUB_EMULATOR_HOST: "127.0.0.1:8085" });
  assert.equal(config.mode, "emulator");
  assert.equal(config.projectId, "foc-local");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 3010);
  assert.deepEqual(config.expectedTopics, [...APPLICATION_TOPICS]);
});

test("the application topics are the six the services create", () => {
  assert.deepEqual([...APPLICATION_TOPICS].sort(), [
    "credit-commands", "credit-events", "order-commands", "order-events", "supplier-events", "user-events",
  ]);
});

test("an emulator host that points at Google is rejected", () => {
  assert.throws(() => loadConfig({ PUBSUB_EMULATOR_HOST: "pubsub.googleapis.com:443" }), /emulator/);
  assert.throws(() => loadConfig({ PUBSUB_EMULATOR_HOST: "https://x.googleapis.com" }), /emulator/);
});

test("limits are validated", () => {
  const base = { PUBSUB_EMULATOR_HOST: "h:1" };
  assert.throws(() => loadConfig({ ...base, TAP_MAX_EVENTS: "0" }), /TAP_MAX_EVENTS/);
  assert.throws(() => loadConfig({ ...base, TAP_MAX_EVENTS: "1000000" }), /TAP_MAX_EVENTS/);
  assert.throws(() => loadConfig({ ...base, TAP_PORT: "abc" }), /TAP_PORT/);
  assert.equal(loadConfig({ ...base, TAP_MAX_EVENTS: "50" }).maxEvents, 50);
});

test("the viewer only answers to local host names unless more are allowed", () => {
  const base = { PUBSUB_EMULATOR_HOST: "h:1" };
  assert.deepEqual(loadConfig(base).allowedHosts, ["localhost", "127.0.0.1", "[::1]"]);
  assert.deepEqual(loadConfig({ ...base, TAP_ALLOWED_HOSTS: "demo.local, 10.0.0.5" }).allowedHosts,
    ["localhost", "127.0.0.1", "[::1]", "demo.local", "10.0.0.5"]);
});

test("only names with the tap prefix count as tap subscriptions", () => {
  assert.ok(isTapSubscriptionName("event-bus-tap-1a2b-order-events"));
  for (const name of [
    "user-events-worker", "supplier-service-user-events", "order-service-user-events", "credit-service-user-events",
    "order-service-supplier-events", "saga-orchestrator-order-events", "credit-service-commands",
    "saga-orchestrator-credit-events", "order-service-order-commands", "notification-store", "notification-1234",
    "event-bus-tapx", "projects/p/subscriptions/user-events-worker",
  ]) assert.ok(!isTapSubscriptionName(name), name);
});

test("remote mode must be chosen explicitly, with a project and existing tap subscriptions", () => {
  const remote = { TAP_MODE: "remote", PUBSUB_PROJECT_ID: "my-project", TAP_REMOTE_SUBSCRIPTIONS: "order-events=event-bus-tap-order-events" };
  const config = loadConfig(remote);
  assert.equal(config.mode, "remote");
  assert.deepEqual(config.remoteSubscriptions, { "order-events": "event-bus-tap-order-events" });
  assert.throws(() => loadConfig({ ...remote, PUBSUB_PROJECT_ID: undefined }), /PUBSUB_PROJECT_ID/);
  assert.throws(() => loadConfig({ ...remote, TAP_REMOTE_SUBSCRIPTIONS: "" }), /TAP_REMOTE_SUBSCRIPTIONS/);
  assert.throws(() => loadConfig({ ...remote, PUBSUB_EMULATOR_HOST: "h:1" }), /PUBSUB_EMULATOR_HOST/);
  assert.throws(() => loadConfig({ ...remote, TAP_REMOTE_SUBSCRIPTIONS: "order-events=saga-orchestrator-order-events" }), /event-bus-tap-/);
  assert.throws(() => loadConfig({ ...remote, TAP_REMOTE_SUBSCRIPTIONS: "order-events" }), /topic=subscription/);
  assert.throws(() => loadConfig({ ...remote, TAP_MODE: "cloud" }), /TAP_MODE/);
});
