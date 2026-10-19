/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: Repair regressions (self-tested) for review findings T1 and T2, in a real browser
 * against the real HTTP/SSE server with an in-memory broker (no emulator, no network):
 * topic rows stop saying "listening" once the broker is unreachable, and the first
 * snapshot keeps the tap's whole buffer when TAP_MAX_EVENTS is above 1000.
 * Writes no evidence files. Author review: Pending.
 */
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";
import { startTap } from "../dist/app.js";
import { loadConfig } from "../dist/config.js";

const CHROME = process.env.CHROME_PATH ?? `${homedir()}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;
const TOPICS = ["user-events", "order-events"];

// Streams opened on it never fail by themselves, like the real client during an outage.
class MemoryBroker {
  down = false;
  subscriptions = new Map();
  listeners = new Map();
  async listTopics() {
    if (this.down) throw new Error("14 UNAVAILABLE: connect ECONNREFUSED 127.0.0.1:8085");
    return TOPICS;
  }
  async createSubscription(topic, name) { this.subscriptions.set(name, { topic, push: false }); }
  async getSubscription(name) { return this.subscriptions.get(name) ?? null; }
  open(name, listener) {
    this.listeners.set(name, listener);
    return { close: async () => { this.listeners.delete(name); } };
  }
  async deleteSubscription(name) { this.subscriptions.delete(name); }
  async close() {}
  deliver(topic, data, id) {
    const [, listener] = [...this.listeners].find(([name]) => name.endsWith(`-${topic}`));
    listener.message({ id, data: Buffer.from(JSON.stringify(data)), attributes: {}, orderingKey: "", publishTime: new Date(), deliveryAttempt: 0, ack() {} });
  }
}

let browser;
before(async () => {
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});
after(async () => {
  await browser?.close();
});

async function start(extra) {
  const broker = new MemoryBroker();
  const config = loadConfig({ PUBSUB_EMULATOR_HOST: "127.0.0.1:1", TAP_PORT: "0", TAP_DISCOVERY_INTERVAL_MS: "500", ...extra });
  const running = await startTap(config, { instanceId: "repair1", broker, log: () => {} });
  for (let i = 0; i < 100 && broker.listeners.size < TOPICS.length; i++) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(broker.listeners.size, TOPICS.length);
  return { broker, running };
}

const states = (page) => page.$$eval("#topics .state", (nodes) => nodes.map((node) => node.textContent));
// True once every live topic's row reads "listening" (the other known topics are "not created yet").
const listening = (topics) => topics.every((topic) => document.querySelector(`#topics li[data-topic-row="${topic}"] .state`)?.textContent === "listening");

test("T1: topic rows stop saying listening while the broker is unreachable", async () => {
  const { broker, running } = await start({});
  const page = await browser.newPage();
  try {
    await page.goto(running.url);
    await page.waitForSelector('#broker[data-state="connected"]');
    await page.waitForFunction(listening, TOPICS);
    broker.down = true;
    await page.waitForSelector('#broker[data-state="unreachable"]', { timeout: 10000 });
    // The tap still holds the topics as "ready"; the page must not show that as healthy.
    assert.ok((await (await fetch(`${running.url}/api/status`)).json()).topics.filter((topic) => TOPICS.includes(topic.topic)).every((topic) => topic.state === "ready"));
    await page.waitForFunction(() => [...document.querySelectorAll("#topics .state")].every((node) => node.textContent !== "listening"));
    assert.deepEqual([...new Set(await states(page))], ["unknown"]);
    assert.match(await page.getAttribute('#topics li[data-topic-row="user-events"] .state', "title"), /Broker unreachable/);
    assert.equal(await page.$$eval("#topics .state-ready", (nodes) => nodes.length), 0, "no green state badge");
    broker.down = false;
    await page.waitForSelector('#broker[data-state="connected"]', { timeout: 10000 });
    await page.waitForFunction(listening, TOPICS);
  } finally {
    await page.close();
    await running.stop();
  }
});

test("T2: the first snapshot keeps the whole tap buffer when TAP_MAX_EVENTS is 1500", async () => {
  const { broker, running } = await start({ TAP_MAX_EVENTS: "1500", TAP_DISCOVERY_INTERVAL_MS: "600000" });
  const page = await browser.newPage();
  try {
    for (let i = 0; i < 1301; i++) broker.deliver(TOPICS[i % 2], { type: "synthetic.repair", n: i }, `m${i}`);
    assert.equal((await (await fetch(`${running.url}/api/status`)).json()).store.size, 1301);
    await page.goto(running.url);
    await page.waitForSelector('#connection[data-state="live"]');
    await page.waitForFunction(() => /Browser holds 1301 of at most 1500\. Tap holds 1301 of at most 1500/.test(document.querySelector("#buffer").textContent));
    // History of a topic that was hidden is complete in the browser.
    await page.click("#none");
    await page.check('#topics input[data-topic="user-events"]');
    assert.match(await page.textContent("#summary"), /of 651 events on selected topics/);
  } finally {
    await page.close();
    await running.stop();
  }
});
