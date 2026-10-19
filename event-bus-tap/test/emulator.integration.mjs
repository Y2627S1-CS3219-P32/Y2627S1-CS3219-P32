/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: Event bus tap against a real Pub/Sub emulator. Each run uses its own random
 * project, so nothing touches foc-local. The messages published here are synthetic,
 * labelled as test messages, and exist only in that throwaway emulator project.
 * Author review: Pending.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { after, before, test } from "node:test";
import { PubSub } from "@google-cloud/pubsub";
import { startTap } from "../dist/app.js";
import { loadConfig } from "../dist/config.js";

const EMULATOR = process.env.PUBSUB_EMULATOR_HOST;
if (!EMULATOR) throw new Error("Set PUBSUB_EMULATOR_HOST to a running Pub/Sub emulator (see EVENT-BUS-TAP-HANDOFF.md)");

const PROJECT = `tap-it-${randomBytes(4).toString("hex")}`;
const INSTANCE = randomBytes(3).toString("hex");
const TEST_LABEL = "SYNTHETIC event-bus-tap integration test message (local emulator only, not business traffic)";
const SECRETS = {
  hash: `scrypt$${"0f".repeat(16)}$${"ab".repeat(64)}`,
  email: "integration.tester@u.nus.edu",
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI3In0.dGVzdHNpZ25hdHVyZQ",
  token: "local-only-order-internal-secret-0000",
};

const admin = new PubSub({ projectId: PROJECT, apiEndpoint: EMULATOR, emulatorMode: true });
const evidence = { emulator: EMULATOR, project: PROJECT, tapInstance: INSTANCE, startedAt: new Date().toISOString(), steps: [] };
const logLines = [];
let running;
const independent = { messageIds: [], subscription: undefined };

function note(step, data) {
  evidence.steps.push({ step, at: new Date().toISOString(), ...data });
}

async function waitFor(check, what, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function publish(topic, data, attributes = {}, orderingKey) {
  const body = typeof data === "string" ? Buffer.from(data) : Buffer.from(JSON.stringify({ _test: TEST_LABEL, ...data }));
  return admin.topic(topic, { messageOrdering: Boolean(orderingKey) })
    .publishMessage({ data: body, attributes: { tapTest: "synthetic", ...attributes }, ...(orderingKey ? { orderingKey } : {}) });
}

const api = async (path, init) => {
  const response = await fetch(new URL(path, running.url), init);
  return { status: response.status, text: await response.text(), type: response.headers.get("content-type") };
};
const status = async () => JSON.parse((await api("/api/status")).text);
const topicStatus = async (topic) => (await status()).topics.find((entry) => entry.topic === topic);
const events = async () => JSON.parse((await api("/api/events")).text).events;
const subscriptionNames = async () => (await admin.getSubscriptions())[0].map((s) => s.name.split("/").at(-1)).sort();

async function readSnapshot() {
  const controller = new AbortController();
  const response = await fetch(new URL("/api/stream", running.url), { signal: controller.signal });
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of response.body) {
    text += decoder.decode(chunk, { stream: true });
    if (/event: snapshot\ndata: .*\n\n/.test(text)) break;
  }
  controller.abort();
  return text;
}

before(async () => {
  // As the services do at startup: topics first, then their own subscriptions.
  await admin.createTopic("user-events");
  await admin.createTopic("order-events");
  // Stands in for an application consumer, e.g. notification-store on order-events.
  const [sub] = await admin.topic("order-events").createSubscription("it-independent-order-consumer");
  independent.subscription = sub;
  sub.on("message", (message) => {
    independent.messageIds.push(message.id);
    message.ack();
  });
  running = await startTap(loadConfig({
    PUBSUB_EMULATOR_HOST: EMULATOR, PUBSUB_PROJECT_ID: PROJECT, TAP_PORT: "0",
    TAP_MAX_EVENTS: "40", TAP_DISCOVERY_INTERVAL_MS: "500",
  }), { instanceId: INSTANCE, log: (line) => logLines.push(line) });
});

after(async () => {
  await running?.stop();
  await independent.subscription?.close();
  note("log lines written by the tap", { lines: logLines });
  for (const line of logLines) {
    for (const secret of Object.values(SECRETS)) assert.ok(!line.includes(secret), `log leaked ${secret}`);
  }
  await admin.close();
  evidence.finishedAt = new Date().toISOString();
  mkdirSync(new URL("../evidence/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../evidence/emulator-integration.json", import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`);
});

test("every existing topic gets its own tap subscription; other subscriptions are untouched", async () => {
  await waitFor(async () => (await status()).ready, "tap ready");
  const names = await subscriptionNames();
  assert.deepEqual(names, [
    `event-bus-tap-${INSTANCE}-order-events`, `event-bus-tap-${INSTANCE}-user-events`, "it-independent-order-consumer",
  ]);
  const current = await status();
  assert.equal(current.broker.state, "connected");
  assert.equal((await topicStatus("supplier-events")).state, "missing");
  note("subscriptions after tap start", { subscriptions: names, topicStates: current.topics.map((t) => [t.topic, t.state]) });
});

test("both topics are captured while an independent consumer still receives every message", async () => {
  const orderIds = [];
  for (let i = 1; i <= 3; i++) {
    const orderId = randomUUID();
    orderIds.push(await publish("order-events", { eventId: randomUUID(), type: "order.created", orderId, sequence: 1 },
      { type: "order.created", orderId }, orderId));
  }
  const userMessageId = await publish("user-events", {
    type: "user.created", eventId: randomUUID(), version: 1,
    user: { id: 7, name: "Test User", displayName: "tester", email: SECRETS.email, role: "student", passwordHash: SECRETS.hash },
    note: `Bearer ${SECRETS.jwt}`, endpoint: `http://order-service:3000/internal/pubsub/x?token=${SECRETS.token}`,
  }, {}, "7");
  const captured = await waitFor(async () => {
    const list = await events();
    return list.length >= 4 ? list : undefined;
  }, "4 captured events");
  await waitFor(() => independent.messageIds.length >= 3, "independent consumer");
  assert.deepEqual([...independent.messageIds].sort(), [...orderIds].sort(), "the independent consumer got all three");
  assert.deepEqual(captured.filter((e) => e.topic === "order-events").map((e) => e.messageId).sort(), [...orderIds].sort(), "the tap got the same three");
  const user = captured.find((e) => e.topic === "user-events");
  assert.equal(user.messageId, userMessageId);
  assert.equal(user.type, "user.created");
  assert.equal(user.payload.user.passwordHash, "[redacted]");
  assert.equal(user.payload.user.email, "i***@u.nus.edu");
  note("fanout", { independentConsumerMessageIds: independent.messageIds, tapOrderMessageIds: orderIds, redactedUserEvent: user });
});

test("no secret leaves the tap through the export, status or stream", async () => {
  const bodies = { export: (await api("/api/events")).text, status: (await api("/api/status")).text, stream: await readSnapshot() };
  for (const [where, body] of Object.entries(bodies)) {
    for (const [name, secret] of Object.entries(SECRETS)) assert.ok(!body.includes(secret), `${name} leaked through ${where}`);
    assert.ok(!body.includes("integration.tester"), `email local part leaked through ${where}`);
  }
  note("secret scan", { checked: Object.keys(bodies), secretKinds: Object.keys(SECRETS), leaks: 0 });
});

test("a topic created after the tap started is discovered and captured", async () => {
  await admin.createTopic("credit-events");
  await waitFor(async () => (await topicStatus("credit-events")).state === "ready", "credit-events subscription");
  const id = await publish("credit-events", { eventId: randomUUID(), type: "credit.reserved", requestId: "r-1", correlationId: "c-1", orderId: "o-1" },
    { type: "credit.reserved", orderId: "o-1" }, "o-1");
  const event = await waitFor(async () => (await events()).find((e) => e.messageId === id), "credit event");
  assert.deepEqual(event.ids, { orderId: "o-1", correlationId: "c-1", requestId: "r-1", eventId: event.ids.eventId });
  note("late topic", { topic: "credit-events", captured: event.messageId });
});

test("a republished message is kept and labelled with the earlier copy", async () => {
  const eventId = randomUUID();
  const first = await publish("order-events", { eventId, type: "order.opened", orderId: "o-dup" }, { type: "order.opened", orderId: "o-dup" });
  const second = await publish("order-events", { eventId, type: "order.opened", orderId: "o-dup" }, { type: "order.opened", orderId: "o-dup" });
  const copies = await waitFor(async () => {
    const list = (await events()).filter((e) => e.ids.eventId === eventId);
    return list.length === 2 ? list : undefined;
  }, "both copies");
  assert.deepEqual(copies.map((e) => e.messageId), [first, second]);
  assert.deepEqual(copies[1].sameIdAs, { seq: copies[0].seq, key: `eventId ${eventId}` });
  note("duplicate labelling", { copies: copies.map(({ seq, messageId, sameIdAs }) => ({ seq, messageId, sameIdAs })) });
});

test("hostile text is kept as plain data and non-JSON payloads are not shown", async () => {
  const hostile = '<img src=x onerror="window.__tapXss=1"><script>window.__tapXss=2</script>';
  const id = await publish("order-events", { eventId: randomUUID(), type: hostile, orderId: "o-x" }, { type: hostile });
  const raw = await publish("order-events", `password=${SECRETS.token} plain text`);
  const list = await waitFor(async () => {
    const all = await events();
    return all.some((e) => e.messageId === id) && all.some((e) => e.messageId === raw) ? all : undefined;
  }, "hostile and raw");
  const exported = await api("/api/events");
  assert.match(exported.type, /^application\/json/);
  assert.equal(list.find((e) => e.messageId === id).type, hostile);
  const text = list.find((e) => e.messageId === raw);
  assert.equal(text.payloadStatus, "not-json");
  assert.equal(text.payload, null);
  note("hostile payloads", { hostileTypeStoredAsString: true, nonJson: { payloadStatus: text.payloadStatus, payload: text.payload } });
});

test("retention stays bounded while capture continues", async () => {
  const before = await status();
  await Promise.all(Array.from({ length: 50 }, (_, i) => publish("user-events", { type: "user.updated", eventId: randomUUID(), version: 100 + i, user: { id: 1000 + i } })));
  await waitFor(async () => (await status()).topics.find((t) => t.topic === "user-events").captured >= 51, "50 more user events");
  const after = await status();
  assert.equal(after.store.size, 40);
  assert.equal(after.store.max, 40);
  assert.ok(after.store.evicted >= before.store.size + 50 - 40);
  assert.equal((await events()).length, 40);
  note("bounded retention", { max: after.store.max, size: after.store.size, evicted: after.store.evicted, capturedByTopic: after.topics.map((t) => [t.topic, t.captured]) });
});

test("a subscription the emulator lost is recreated and capture resumes", async () => {
  const name = `event-bus-tap-${INSTANCE}-order-events`;
  await admin.subscription(name).delete();
  await waitFor(async () => {
    const entry = await topicStatus("order-events");
    return entry.resubscriptions === 1 && entry.state === "ready";
  }, "resubscription", 20000);
  const id = await publish("order-events", { eventId: randomUUID(), type: "order.accepted", orderId: "o-r" }, { type: "order.accepted", orderId: "o-r" });
  await waitFor(async () => (await events()).some((e) => e.messageId === id), "message after resubscription", 20000);
  note("recovery", { deleted: name, resubscriptions: (await topicStatus("order-events")).resubscriptions, capturedAfter: id });
});

test("refresh requires the custom header and unknown hosts are refused", async () => {
  assert.equal((await api("/api/refresh", { method: "POST" })).status, 403);
  assert.equal((await api("/api/refresh", { method: "POST", headers: { "X-Tap-Request": "1" } })).status, 200);
  // fetch() drops a custom Host header, so this request is made with node:http.
  const rebinding = await new Promise((resolve, reject) => {
    request(new URL("/api/events", running.url), { headers: { host: "evil.example" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on("error", reject).end();
  });
  assert.equal(rebinding, 421);
  note("request guards", { refreshWithoutHeader: 403, refreshWithHeader: 200, foreignHost: 421 });
});

test("shutdown deletes only the tap's own subscriptions", async () => {
  await running.stop();
  running = undefined;
  const names = await subscriptionNames();
  assert.deepEqual(names, ["it-independent-order-consumer"]);
  note("after shutdown", { subscriptions: names });
});
