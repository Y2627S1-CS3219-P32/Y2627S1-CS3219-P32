/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: Tap supervisor. Pub/Sub has no wildcard subscription, so the tap discovers
 * every topic and gives each one its own subscription: a separate copy of the stream
 * that takes nothing from the application's subscriptions. It acknowledges every
 * delivery on its own subscriptions only, retries with capped backoff, and recreates
 * subscriptions the emulator lost. Author review: Pending.
 */
import { EventEmitter } from "node:events";
import type { Broker, ReceivedMessage, SubscriptionHandle } from "./broker.js";
import { toCapturedEvent, topicKind, type TopicKind } from "./capture.js";
import { isTapSubscriptionName, TAP_SUBSCRIPTION_PREFIX, type TapConfig } from "./config.js";
import { describeError } from "./redact.js";
import type { EventStore, StoredEvent } from "./store.js";

export type TopicState = "missing" | "subscribing" | "ready" | "retrying" | "error";
export type BrokerState = "connecting" | "connected" | "unreachable";
export type Schedule = (fn: () => void | Promise<void>, ms: number) => () => void;

const MAX_RETRY_MS = 30_000;
// A subscription that stayed open this long is healthy again, so backoff restarts.
const STABLE_MS = 60_000;

interface TopicTap {
  topic: string;
  expected: boolean;
  present: boolean;
  subscription: string | null;
  state: TopicState;
  owned: boolean;
  handle: SubscriptionHandle | undefined;
  generation: number;
  subscribedSince: string | null;
  lastMessageAt: string | null;
  lastError: string | null;
  attempts: number;
  openedAt: number;
  retryInMs: number | null;
  cancelRetry: (() => void) | undefined;
  resubscriptions: number;
}

export interface TopicStatus {
  topic: string;
  kind: TopicKind;
  expected: boolean;
  present: boolean;
  subscription: string | null;
  state: TopicState;
  subscribedSince: string | null;
  lastMessageAt: string | null;
  lastError: string | null;
  retryInMs: number | null;
  resubscriptions: number;
  captured: number;
}

export interface TapStatus {
  instanceId: string;
  mode: TapConfig["mode"];
  projectId: string;
  emulatorHost: string | null;
  startedAt: string;
  broker: { state: BrokerState; lastDiscoveryAt: string | null; lastError: string | null };
  topics: TopicStatus[];
  store: { size: number; max: number; evicted: number };
  captureErrors: number;
  ready: boolean;
}

const defaultSchedule: Schedule = (fn, ms) => {
  const timer = setTimeout(() => {
    Promise.resolve().then(fn).catch((error: unknown) => console.error("[event-bus-tap] Scheduled task failed", describeError(error)));
  }, ms);
  timer.unref();
  return () => clearTimeout(timer);
};

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 6;
}

export interface TapOptions {
  config: TapConfig;
  broker: Broker;
  store: EventStore;
  instanceId: string;
  schedule?: Schedule;
  log?: (line: string) => void;
}

export class Tap extends EventEmitter {
  readonly instanceId: string;
  readonly discoveryIntervalMs: number;
  readonly #config: TapConfig;
  readonly #broker: Broker;
  readonly #store: EventStore;
  readonly #schedule: Schedule;
  readonly #log: (line: string) => void;
  readonly #topics = new Map<string, TopicTap>();
  readonly #startedAt = new Date().toISOString();
  #brokerState: BrokerState = "connecting";
  #lastDiscoveryAt: string | null = null;
  #brokerError: string | null = null;
  #captureErrors = 0;
  #discovering: Promise<void> | undefined;
  #cancelDiscovery: (() => void) | undefined;
  #statusQueued = false;
  #stopped = false;

  constructor(options: TapOptions) {
    super();
    this.#config = options.config;
    this.#broker = options.broker;
    this.#store = options.store;
    this.instanceId = options.instanceId;
    this.discoveryIntervalMs = options.config.discoveryIntervalMs;
    this.#schedule = options.schedule ?? defaultSchedule;
    this.#log = options.log ?? ((line) => console.log(`[event-bus-tap] ${line}`));
    for (const topic of this.#config.expectedTopics) this.#entry(topic).expected = true;
  }

  async start(): Promise<void> {
    await this.discover();
    const loop = () => {
      this.#cancelDiscovery = this.#schedule(async () => {
        await this.discover();
        if (!this.#stopped) loop();
      }, this.discoveryIntervalMs);
    };
    loop();
  }

  // Concurrent callers (interval, refresh button) share one run.
  discover(): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    this.#discovering ??= (this.#config.mode === "emulator" ? this.#discoverEmulator() : this.#discoverRemote())
      .catch((error: unknown) => this.#log(`Discovery failed: ${describeError(error)}`))
      .finally(() => {
        this.#discovering = undefined;
        this.#lastDiscoveryAt = new Date().toISOString();
        this.#changed();
      });
    return this.#discovering;
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#cancelDiscovery?.();
    await this.#discovering;
    for (const entry of this.#topics.values()) {
      entry.cancelRetry?.();
      await entry.handle?.close().catch(() => undefined);
      entry.handle = undefined;
    }
    // Only subscriptions this process created, and never in remote mode.
    if (this.#config.mode === "emulator") {
      for (const entry of this.#topics.values()) {
        if (!entry.owned || !entry.subscription) continue;
        await this.#broker.deleteSubscription(entry.subscription)
          .then(() => this.#log(`Deleted ${entry.subscription}`))
          .catch((error: unknown) => this.#log(`Could not delete ${entry.subscription}: ${describeError(error)}`));
      }
    }
    await this.#broker.close().catch(() => undefined);
  }

  status(): TapStatus {
    const captured = this.#store.capturedByTopic();
    const expected = this.#config.expectedTopics.map((topic) => this.#topics.get(topic)!);
    const extra = [...this.#topics.values()].filter((entry) => !entry.expected).sort((a, b) => a.topic.localeCompare(b.topic));
    const topics = [...expected, ...extra].map((entry): TopicStatus => ({
      topic: entry.topic,
      kind: topicKind(entry.topic),
      expected: entry.expected,
      present: entry.present,
      subscription: entry.subscription,
      state: entry.state,
      subscribedSince: entry.subscribedSince,
      lastMessageAt: entry.lastMessageAt,
      lastError: entry.lastError,
      retryInMs: entry.retryInMs,
      resubscriptions: entry.resubscriptions,
      captured: captured[entry.topic] ?? 0,
    }));
    return {
      instanceId: this.instanceId,
      mode: this.#config.mode,
      projectId: this.#config.projectId,
      emulatorHost: this.#config.emulatorHost ?? null,
      startedAt: this.#startedAt,
      broker: { state: this.#brokerState, lastDiscoveryAt: this.#lastDiscoveryAt, lastError: this.#brokerError },
      topics,
      store: { size: this.#store.size, max: this.#store.maxEvents, evicted: this.#store.evicted },
      captureErrors: this.#captureErrors,
      // Ready once the broker answered and every topic that exists is being read.
      ready: this.#brokerState === "connected" && topics.every((topic) => !topic.present || topic.state === "ready"),
    };
  }

  #entry(topic: string): TopicTap {
    let entry = this.#topics.get(topic);
    if (!entry) {
      entry = {
        topic, expected: false, present: false, subscription: null, state: "missing", owned: false, handle: undefined,
        generation: 0, subscribedSince: null, lastMessageAt: null, lastError: null, attempts: 0, openedAt: 0,
        retryInMs: null, cancelRetry: undefined, resubscriptions: 0,
      };
      this.#topics.set(topic, entry);
    }
    return entry;
  }

  async #discoverEmulator(): Promise<void> {
    let names: string[];
    try {
      names = await this.#broker.listTopics();
    } catch (error) {
      this.#setBroker("unreachable", describeError(error));
      return;
    }
    this.#setBroker("connected", null);
    const present = new Set(names);
    for (const name of names) this.#entry(name);
    for (const entry of this.#topics.values()) {
      if (this.#stopped) return;
      entry.present = present.has(entry.topic);
      if (!entry.present) {
        if (entry.handle || entry.state === "ready" || entry.state === "retrying") {
          entry.cancelRetry?.();
          entry.cancelRetry = undefined;
          await this.#closeHandle(entry);
          this.#setState(entry, "missing", "Topic no longer exists");
        }
        continue;
      }
      if (entry.state === "missing") {
        await this.#subscribeEmulator(entry);
      } else if (entry.state === "ready" && entry.subscription) {
        // The emulator keeps subscriptions in memory; a restart loses them silently.
        const info = await this.#broker.getSubscription(entry.subscription).catch(() => undefined);
        if (info === null) {
          await this.#closeHandle(entry);
          await this.#subscribeEmulator(entry);
        }
      }
    }
  }

  async #subscribeEmulator(entry: TopicTap): Promise<void> {
    const name = entry.subscription ?? `${TAP_SUBSCRIPTION_PREFIX}${this.instanceId}-${entry.topic}`;
    if (!isTapSubscriptionName(name)) {
      this.#setState(entry, "error", `Cannot build a valid tap subscription name for topic ${entry.topic}`);
      return;
    }
    entry.subscription = name;
    this.#setState(entry, "subscribing", null);
    try {
      let create = !entry.owned;
      if (entry.owned) {
        const info = await this.#broker.getSubscription(name);
        if (info && info.topic !== entry.topic) await this.#broker.deleteSubscription(name);
        create = !info || info.topic !== entry.topic;
      }
      if (create) {
        await this.#broker.createSubscription(entry.topic, name);
        if (entry.owned) {
          // Found missing by discovery or by a stream error: messages in between are lost.
          entry.resubscriptions++;
          this.#log(`${entry.topic}: subscription ${name} had disappeared; recreated it`);
        }
        entry.owned = true;
        entry.subscribedSince = new Date().toISOString();
      }
      if (this.#stopped) return;
      this.#open(entry, name);
    } catch (error) {
      if (isAlreadyExists(error) && !entry.owned) {
        // Someone else's subscription: reading it would take messages from its consumer.
        this.#setState(entry, "error", `A subscription named ${name} already exists; the tap only reads subscriptions it created itself`);
        return;
      }
      this.#scheduleRetry(entry, error);
    }
  }

  async #discoverRemote(): Promise<void> {
    for (const [topic, name] of Object.entries(this.#config.remoteSubscriptions)) {
      const entry = this.#entry(topic);
      entry.present = true;
      entry.subscription = name;
    }
    let reached = false;
    let failure: string | null = null;
    for (const entry of this.#topics.values()) {
      if (this.#stopped) return;
      if (!entry.subscription) {
        this.#setState(entry, "missing", "Not configured in TAP_REMOTE_SUBSCRIPTIONS");
        continue;
      }
      if (entry.state === "ready" || entry.state === "retrying" || entry.state === "subscribing") continue;
      try {
        await this.#subscribeRemote(entry, entry.subscription);
        reached = true;
      } catch (error) {
        failure = describeError(error);
        this.#scheduleRetry(entry, error);
      }
    }
    if (reached || failure === null) this.#setBroker("connected", null);
    else this.#setBroker("unreachable", failure);
  }

  // Read-only: checks the operator-created subscription and pulls from it.
  async #subscribeRemote(entry: TopicTap, name: string): Promise<void> {
    this.#setState(entry, "subscribing", null);
    const info = await this.#broker.getSubscription(name);
    if (!info) {
      this.#setState(entry, "error", `Subscription ${name} does not exist; remote mode never creates subscriptions`);
      return;
    }
    if (info.topic !== entry.topic) {
      this.#setState(entry, "error", `Subscription ${name} belongs to topic ${info.topic}, not ${entry.topic}`);
      return;
    }
    if (info.push) {
      this.#setState(entry, "error", `Subscription ${name} is a push subscription; the tap needs its own pull subscription`);
      return;
    }
    entry.subscribedSince ??= new Date().toISOString();
    this.#open(entry, name);
  }

  #open(entry: TopicTap, name: string): void {
    const generation = ++entry.generation;
    entry.handle = this.#broker.open(name, {
      message: (message) => this.#onMessage(entry, name, message),
      error: (error) => this.#onError(entry, generation, error),
    });
    entry.openedAt = Date.now();
    entry.retryInMs = null;
    this.#setState(entry, "ready", null);
  }

  #onMessage(entry: TopicTap, name: string, message: ReceivedMessage): void {
    try {
      const stored: StoredEvent = this.#store.add(
        toCapturedEvent(entry.topic, name, message, new Date(), this.#config.maxPayloadBytes),
      );
      entry.lastMessageAt = stored.receivedAt;
      entry.attempts = 0;
      this.emit("event", stored);
    } catch (error) {
      this.#captureErrors++;
      this.#log(`${entry.topic}: could not record message: ${describeError(error)}`);
    } finally {
      // Always acknowledged: this copy exists only for the tap, and a nack would
      // redeliver the same message forever.
      message.ack();
    }
  }

  #onError(entry: TopicTap, generation: number, error: Error): void {
    if (generation !== entry.generation || this.#stopped) return;
    void this.#closeHandle(entry);
    this.#scheduleRetry(entry, error);
  }

  #scheduleRetry(entry: TopicTap, error: unknown): void {
    if (this.#stopped) return;
    if (entry.openedAt && Date.now() - entry.openedAt > STABLE_MS) entry.attempts = 0;
    const delay = Math.min(1000 * 2 ** entry.attempts, MAX_RETRY_MS);
    entry.attempts++;
    entry.retryInMs = delay;
    entry.cancelRetry?.();
    this.#setState(entry, "retrying", describeError(error));
    entry.cancelRetry = this.#schedule(async () => {
      entry.cancelRetry = undefined;
      if (this.#stopped) return;
      if (this.#config.mode === "emulator") {
        await this.#subscribeEmulator(entry);
      } else if (entry.subscription) {
        await this.#subscribeRemote(entry, entry.subscription).catch((retryError: unknown) => this.#scheduleRetry(entry, retryError));
      }
    }, delay);
  }

  async #closeHandle(entry: TopicTap): Promise<void> {
    const handle = entry.handle;
    entry.handle = undefined;
    entry.generation++;
    await handle?.close().catch(() => undefined);
  }

  #setState(entry: TopicTap, state: TopicState, error: string | null): void {
    const changed = entry.state !== state || entry.lastError !== error;
    entry.state = state;
    entry.lastError = error;
    if (state !== "retrying") entry.retryInMs = null;
    if (!changed) return;
    if (state === "ready" || state === "retrying" || state === "error") {
      this.#log(`${entry.topic}: ${state}${entry.subscription ? ` (${entry.subscription})` : ""}${error ? `: ${error}` : ""}`);
    }
    this.#changed();
  }

  #setBroker(state: BrokerState, error: string | null): void {
    if (this.#brokerState !== state) this.#log(`Broker ${state}${error ? `: ${error}` : ""}`);
    this.#brokerState = state;
    this.#brokerError = error;
  }

  // Coalesces bursts of changes into one status broadcast.
  #changed(): void {
    if (this.#statusQueued) return;
    this.#statusQueued = true;
    queueMicrotask(() => {
      this.#statusQueued = false;
      this.emit("status", this.status());
    });
  }
}
