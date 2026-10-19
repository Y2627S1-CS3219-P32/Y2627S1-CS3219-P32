/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: Event bus tap configuration. The emulator is the default and the only mode
 * that creates anything; remote mode must be chosen explicitly and only reads
 * subscriptions an operator created beforehand. Author review: Pending.
 */

// Every topic created by the services at startup (see each service's Pub/Sub setup).
export const APPLICATION_TOPICS = [
  "user-events", "supplier-events", "order-events", "order-commands", "credit-commands", "credit-events",
] as const;

// Every subscription the tap creates or reads starts with this, so it can never be an
// application subscription (user-events-worker, notification-store, saga-..., ...).
export const TAP_SUBSCRIPTION_PREFIX = "event-bus-tap-";

export function isTapSubscriptionName(name: string): boolean {
  return /^event-bus-tap-[A-Za-z0-9][A-Za-z0-9._~+%-]{0,200}$/.test(name);
}

export type TapMode = "emulator" | "remote";

export interface TapConfig {
  mode: TapMode;
  projectId: string;
  emulatorHost: string | undefined;
  host: string;
  port: number;
  // Host header names the viewer answers to; blocks DNS-rebinding pages from reading it.
  allowedHosts: string[];
  expectedTopics: string[];
  remoteSubscriptions: Record<string, string>;
  maxEvents: number;
  maxPayloadBytes: number;
  maxClients: number;
  discoveryIntervalMs: number;
}

type Env = Record<string, string | undefined>;

function integer(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function list(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function remoteSubscriptions(value: string | undefined): Record<string, string> {
  const entries = list(value).map((pair) => {
    const [topic, subscription, ...rest] = pair.split("=").map((part) => part.trim());
    if (!topic || !subscription || rest.length > 0) {
      throw new Error("TAP_REMOTE_SUBSCRIPTIONS must be a comma-separated list of topic=subscription");
    }
    if (!isTapSubscriptionName(subscription)) {
      throw new Error(`Remote subscription ${subscription} must be a tap subscription named ${TAP_SUBSCRIPTION_PREFIX}...`);
    }
    return [topic, subscription] as const;
  });
  if (entries.length === 0) throw new Error("TAP_REMOTE_SUBSCRIPTIONS is required in remote mode");
  return Object.fromEntries(entries);
}

export function loadConfig(env: Env = process.env): TapConfig {
  const mode = env.TAP_MODE ?? "emulator";
  if (mode !== "emulator" && mode !== "remote") throw new Error("TAP_MODE must be emulator or remote");
  const emulatorHost = env.PUBSUB_EMULATOR_HOST || undefined;

  if (mode === "emulator") {
    // Without it the client library would fall through to real Google Cloud.
    if (!emulatorHost) throw new Error("PUBSUB_EMULATOR_HOST must be set (e.g. pubsub-emulator:8085); remote Pub/Sub needs TAP_MODE=remote");
    if (/googleapis\.com|^https:/i.test(emulatorHost)) throw new Error("PUBSUB_EMULATOR_HOST must point at a local emulator");
  } else {
    if (emulatorHost) throw new Error("Unset PUBSUB_EMULATOR_HOST for TAP_MODE=remote, or use emulator mode");
    if (!env.PUBSUB_PROJECT_ID) throw new Error("PUBSUB_PROJECT_ID must be set explicitly for TAP_MODE=remote");
  }

  const expected = list(env.TAP_EXPECTED_TOPICS);
  return {
    mode,
    projectId: env.PUBSUB_PROJECT_ID || "foc-local",
    emulatorHost: mode === "emulator" ? emulatorHost : undefined,
    host: env.TAP_HOST || "127.0.0.1",
    port: integer(env, "TAP_PORT", 3010, 0, 65535),
    allowedHosts: ["localhost", "127.0.0.1", "[::1]", ...list(env.TAP_ALLOWED_HOSTS).map((name) => name.toLowerCase())],
    expectedTopics: expected.length > 0 ? expected : [...APPLICATION_TOPICS],
    remoteSubscriptions: mode === "remote" ? remoteSubscriptions(env.TAP_REMOTE_SUBSCRIPTIONS) : {},
    maxEvents: integer(env, "TAP_MAX_EVENTS", 1000, 1, 20000),
    maxPayloadBytes: integer(env, "TAP_MAX_PAYLOAD_BYTES", 65536, 1024, 1048576),
    maxClients: integer(env, "TAP_MAX_CLIENTS", 20, 1, 200),
    discoveryIntervalMs: integer(env, "TAP_DISCOVERY_INTERVAL_MS", 5000, 500, 600000),
  };
}
