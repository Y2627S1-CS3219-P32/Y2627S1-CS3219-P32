/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: The viewer in a real browser against a real Pub/Sub emulator: topic toggles
 * filter only the display, capture continues for hidden topics, hostile text stays
 * text, secrets never reach the page, and loading/disconnected/error states show.
 * Messages are synthetic, labelled, and published into a throwaway emulator project.
 * Author review: Pending.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { after, before, test } from "node:test";
import { PubSub } from "@google-cloud/pubsub";
import { chromium } from "playwright-core";
import { startTap } from "../dist/app.js";
import { loadConfig } from "../dist/config.js";

const EMULATOR = process.env.PUBSUB_EMULATOR_HOST;
if (!EMULATOR) throw new Error("Set PUBSUB_EMULATOR_HOST to a running Pub/Sub emulator (see EVENT-BUS-TAP-HANDOFF.md)");
const CHROME = process.env.CHROME_PATH ?? `${homedir()}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;

const PROJECT = `tap-ui-${randomBytes(4).toString("hex")}`;
const TEST_LABEL = "SYNTHETIC event-bus-tap browser test message (local emulator only, not business traffic)";
const SECRETS = [`scrypt$${"1e".repeat(16)}$${"cd".repeat(64)}`, "browser.tester@u.nus.edu", "browser.tester",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI5In0.YnJvd3NlcnNpZw"];
const HOSTILE = '<img src=x onerror="window.__tapXss=1"><script>window.__tapXss=2</script>';
const EVIDENCE = new URL("../evidence/", import.meta.url);

const admin = new PubSub({ projectId: PROJECT, apiEndpoint: EMULATOR, emulatorMode: true });
const evidence = { emulator: EMULATOR, project: PROJECT, browser: CHROME, startedAt: new Date().toISOString(), steps: [] };
const independent = { ids: [], sub: undefined };
let browser, page, running, port;

const config = (extra = {}) => loadConfig({
  PUBSUB_EMULATOR_HOST: EMULATOR, PUBSUB_PROJECT_ID: PROJECT, TAP_PORT: String(port ?? 0),
  TAP_MAX_EVENTS: "15", TAP_DISCOVERY_INTERVAL_MS: "500", ...extra,
});

async function publish(topic, data, attributes = {}) {
  return admin.topic(topic).publishMessage({ json: { _test: TEST_LABEL, ...data }, attributes: { tapTest: "synthetic", ...attributes } });
}

async function shot(name, step, data = {}) {
  await page.screenshot({ path: new URL(`browser-${name}.png`, EVIDENCE).pathname, fullPage: true });
  evidence.steps.push({ step, screenshot: `evidence/browser-${name}.png`, at: new Date().toISOString(), ...data });
}

const rowTopics = () => page.$$eval("#events tr.event", (rows) => rows.map((row) => row.dataset.topic));
const topicMeta = (topic) => page.$eval(`#topics li[data-topic-row="${topic}"] .topic-meta`, (node) => node.textContent);
const capturedOf = async (topic) => Number((await topicMeta(topic)).match(/captured (\d+)/)[1]);
const pageText = () => page.evaluate(() => document.documentElement.outerHTML + document.body.innerText);

async function assertNoSecrets(where) {
  const text = await pageText();
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `${secret} reached the page (${where})`);
}

before(async () => {
  mkdirSync(EVIDENCE, { recursive: true });
  await admin.createTopic("user-events");
  await admin.createTopic("order-events");
  const [sub] = await admin.topic("order-events").createSubscription("ui-independent-order-consumer");
  independent.sub = sub;
  sub.on("message", (message) => {
    independent.ids.push(message.id);
    message.ack();
  });
  running = await startTap(config(), { instanceId: "ui0001", log: () => {} });
  port = Number(new URL(running.url).port);
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("pageerror", (error) => evidence.steps.push({ step: "page error", message: error.message }));
});

after(async () => {
  await browser?.close();
  await running?.stop();
  await independent.sub?.close();
  await admin.close();
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(new URL("browser-integration.json", EVIDENCE), `${JSON.stringify(evidence, null, 2)}\n`);
});

test("the page shows a loading state until the stream answers", async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/stream", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(running.url);
  assert.equal(await page.getAttribute("#connection", "data-state"), "connecting");
  assert.equal(await page.textContent("#empty"), "Loading…");
  await shot("1-loading", "loading state before the stream answers");
  release();
  await page.waitForSelector('#connection[data-state="live"]');
  await page.unroute("**/api/stream");
  await page.waitForSelector('#broker[data-state="connected"]');
  await page.waitForFunction(() => document.querySelector("#broker").textContent.includes("all topics subscribed"));
});

test("both topics are captured; unticking one hides it while capture continues", async () => {
  await publish("user-events", {
    type: "user.created", eventId: randomUUID(), version: 1,
    user: { id: 9, name: "Browser Tester", displayName: "bt", email: SECRETS[1], role: "student", passwordHash: SECRETS[0] },
    note: `Bearer ${SECRETS[3]}`,
  });
  const orderId = randomUUID();
  await publish("order-events", { eventId: randomUUID(), type: "order.created", orderId, sequence: 1 }, { type: "order.created", orderId });
  await page.waitForFunction(() => document.querySelectorAll("#events tr.event").length >= 2);
  assert.deepEqual((await rowTopics()).sort(), ["order-events", "user-events"]);
  await shot("2-both-topics", "both topics captured and shown");

  await page.uncheck('input[data-topic="user-events"]');
  assert.deepEqual(await rowTopics(), ["order-events"]);
  // A user event arriving while its topic is hidden is still captured.
  const before = await capturedOf("user-events");
  await publish("user-events", { type: "user.updated", eventId: randomUUID(), version: 2, user: { id: 9, displayName: "bt2" } });
  await page.waitForFunction((n) => /captured (\d+)/.exec(document.querySelector('#topics li[data-topic-row="user-events"] .topic-meta').textContent)[1] > n, before);
  assert.deepEqual(await rowTopics(), ["order-events"], "still only order-events visible");
  const exported = await (await fetch(`${running.url}/api/events`)).json();
  assert.equal(exported.events.filter((event) => event.topic === "user-events").length, 2, "tap captured both user events");
  const summary = await page.textContent("#summary");
  assert.match(summary, /2 captured on unticked topics are hidden/);
  await shot("3-only-order-events", "user-events unticked: only order-events shown, user-events still captured", {
    userEventsCaptured: await capturedOf("user-events"), visibleTopics: await rowTopics(), summary,
  });
});

test("switching the filter shows already captured events coherently", async () => {
  await page.check('input[data-topic="user-events"]');
  await page.uncheck('input[data-topic="order-events"]');
  const topics = await rowTopics();
  assert.deepEqual(topics, ["user-events", "user-events"]);
  await shot("4-only-user-events", "filter switched: the user event that arrived while hidden is shown", { visibleTopics: topics });
  await page.check('input[data-topic="order-events"]');
  assert.equal((await rowTopics()).length, 3);
});

test("expanded JSON is redacted and no secret reaches the page", async () => {
  await page.click('#events tr.event[data-topic="user-events"]:last-of-type');
  const payload = await page.textContent("#events tr.detail pre.payload");
  assert.match(payload, /"passwordHash": "\[redacted\]"/);
  assert.match(payload, /"email": "b\*\*\*@u\.nus\.edu"/);
  await assertNoSecrets("expanded user event");
  await shot("5-expanded-redacted", "expanded user event: hash and token redacted, e-mail masked", { payloadExcerpt: payload.slice(0, 600) });
});

test("hostile payload text is displayed as text and never executed", async () => {
  await publish("order-events", { eventId: randomUUID(), type: HOSTILE, orderId: "o-hostile" }, { type: HOSTILE, orderId: "o-hostile" });
  await page.waitForFunction(() => [...document.querySelectorAll("#events td.type")].some((cell) => cell.textContent.includes("<img")));
  assert.equal(await page.evaluate(() => window.__tapXss), undefined);
  assert.equal(await page.$$eval("#events img, #events script", (nodes) => nodes.length), 0);
  await shot("6-hostile-text", "hostile type shown as literal text; no element created, no script ran");
});

test("retention is bounded in the tap and in the browser", async () => {
  await Promise.all(Array.from({ length: 30 }, (_, i) => publish("order-events", { eventId: randomUUID(), type: "order.opened", orderId: `o-${i}` }, { type: "order.opened" })));
  await page.waitForFunction(() => /Tap holds 15 of at most 15/.test(document.querySelector("#buffer").textContent));
  await page.waitForFunction(() => document.querySelectorAll("#events tr.event").length === 15);
  const buffer = await page.textContent("#buffer");
  assert.match(buffer, /Browser holds 15 of at most 15/);
  await shot("7-bounded", "after 30 more events: 15 held by tap and browser", { buffer });
});

test("an independent consumer of the same topic still received every order event", async () => {
  const captured = (await running.store.capturedByTopic())["order-events"];
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(independent.ids.length, captured);
  evidence.steps.push({ step: "fanout during browser test", independentConsumerReceived: independent.ids.length, tapCapturedOrderEvents: captured });
});

test("losing the tap shows a disconnected state, and the page reconnects to a restarted tap", async () => {
  await running.stop();
  await page.waitForSelector('#connection[data-state="disconnected"]', { timeout: 10000 });
  await shot("8-disconnected", "tap stopped: viewer shows disconnected and keeps retrying");
  running = await startTap(config(), { instanceId: "ui0002", log: () => {} });
  await page.waitForSelector('#connection[data-state="live"]', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector("#broker").textContent.includes("all topics subscribed"), null, { timeout: 20000 });
  // A restarted tap only sees messages published after it subscribed.
  assert.equal(await page.$$eval("#events tr.event", (rows) => rows.length), 0);
  const orderId = randomUUID();
  await publish("order-events", { eventId: randomUUID(), type: "order.accepted", orderId }, { type: "order.accepted", orderId });
  await page.waitForFunction(() => document.querySelectorAll("#events tr.event").length === 1);
  await shot("9-reconnected", "restarted tap: viewer reconnected and shows new traffic only");
});

test("an unreachable broker is shown as an error", async () => {
  await running.stop();
  // Nothing listens on port 9 here; the emulator host is deliberately wrong.
  running = await startTap(loadConfig({ PUBSUB_EMULATOR_HOST: "127.0.0.1:9", PUBSUB_PROJECT_ID: PROJECT, TAP_PORT: String(port), TAP_DISCOVERY_INTERVAL_MS: "1000" }),
    { instanceId: "ui0003", log: () => {} });
  await page.waitForSelector('#broker[data-state="unreachable"]', { timeout: 30000 });
  const text = await page.textContent("#broker");
  assert.ok(text.length < 130, "long errors are shortened in the badge");
  // Without an answer from the broker the tap cannot know whether topics exist.
  assert.deepEqual([...new Set(await page.$$eval("#topics .state", (nodes) => nodes.map((node) => node.textContent)))], ["unknown"]);
  await shot("10-broker-unreachable", "broker unreachable shown with its error", { broker: text });
  await assertNoSecrets("final page");
});
