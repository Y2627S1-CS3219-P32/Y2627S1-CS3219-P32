/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
 * Scope: Order-ranking-service environment configuration: auth and Pub/Sub as in
 * order-service, the embedding provider, and the ranking weights and reason thresholds.
 * Author review: Pending.
 * Claude Code (Opus 5.5), 2026-11-11: any OpenAI-compatible embeddings API (SoCLaaS in
 * production): EMBEDDING_MODEL is required away from OpenAI's API, and sending `dimensions` can
 * be turned off. Author review: Pending.
 */
import "dotenv/config";

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function boolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  if (value !== "true" && value !== "false") throw new Error(`${name} must be true or false`);
  return value === "true";
}

function number(name: string, fallback: number, min = 0, max = Number.POSITIVE_INFINITY): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be a number from ${min} to ${max}`);
  return value;
}

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || Buffer.byteLength(jwtSecret) < 32) {
  throw new Error("JWT_SECRET must be set to at least 32 bytes (the same secret as user-service)");
}

const internalSharedSecret = process.env.INTERNAL_SHARED_SECRET || undefined;
if (internalSharedSecret && Buffer.byteLength(internalSharedSecret) < 32) {
  throw new Error("INTERNAL_SHARED_SECRET must be at least 32 bytes when configured");
}

const openaiApiKey = process.env.OPENAI_API_KEY || undefined;
const provider = process.env.EMBEDDING_PROVIDER || (openaiApiKey ? "openai" : "hashing");
if (provider !== "openai" && provider !== "hashing") {
  throw new Error("EMBEDDING_PROVIDER must be openai or hashing");
}
if (provider === "openai" && !openaiApiKey) {
  throw new Error("OPENAI_API_KEY is required when EMBEDDING_PROVIDER is openai");
}

// "openai" means any OpenAI-compatible POST /embeddings API, such as SoCLaaS.
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const openaiBaseUrl = (process.env.OPENAI_BASE_URL || OPENAI_BASE_URL).replace(/\/+$/, "");
const embeddingModel = process.env.EMBEDDING_MODEL || undefined;
// Other APIs have their own model IDs, so OpenAI's default model name is not assumed there.
if (provider === "openai" && !embeddingModel && openaiBaseUrl !== OPENAI_BASE_URL) {
  throw new Error(`EMBEDDING_MODEL is required when OPENAI_BASE_URL is not ${OPENAI_BASE_URL}: use an embeddings-capable model ID from GET ${openaiBaseUrl}/models`);
}

export const config = {
  port: positiveInteger("PORT", 3000),
  jwtSecret,
  // Same internal authentication as order-service: a Google-signed OIDC token for an
  // allowed service account, or, for local development only, a shared secret.
  internalSharedSecret,
  internalAudience: process.env.INTERNAL_AUDIENCE || undefined,
  internalInvokerEmails: (process.env.INTERNAL_INVOKER_EMAILS ?? "")
    .split(",").map((email) => email.trim()).filter(Boolean),
  pubsub: {
    projectId: process.env.PUBSUB_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? "foc-local",
    emulatorHost: process.env.PUBSUB_EMULATOR_HOST || undefined,
    // Base URL the emulator pushes to, e.g. http://order-ranking-service:3000 (local only).
    pushBaseUrl: process.env.PUBSUB_PUSH_BASE_URL || undefined,
    orderEventsTopic: process.env.ORDER_EVENTS_TOPIC ?? "order-events",
    supplierEventsTopic: process.env.SUPPLIER_EVENTS_TOPIC ?? "supplier-events",
  },
  embedding: {
    // "hashing" is a keyless local fallback (word overlap only) for development and tests.
    provider: provider as "openai" | "hashing",
    openaiApiKey,
    openaiBaseUrl,
    model: embeddingModel ?? "text-embedding-3-small",
    // Asks for EMBEDDING_DIMENSIONS-long vectors (the pgvector column size). Set to false for a
    // model that returns that length itself but rejects the `dimensions` parameter.
    sendDimensions: boolean("EMBEDDING_SEND_DIMENSIONS", true),
    // Orders whose embedding failed are retried this many times before being left without one.
    maxAttempts: positiveInteger("EMBEDDING_MAX_ATTEMPTS", 5),
    batchSize: positiveInteger("EMBEDDING_BATCH_SIZE", 50),
  },
  ranking: {
    // How much each part counts towards the score. Parts without data are left out.
    weights: {
      semantic: number("RANK_WEIGHT_SEMANTIC", 0.4),
      distance: number("RANK_WEIGHT_DISTANCE", 0.25),
      time: number("RANK_WEIGHT_TIME", 0.15),
      preference: number("RANK_WEIGHT_PREFERENCE", 0.15),
      reward: number("RANK_WEIGHT_REWARD", 0.05),
    },
    // A part is given as a reason only when its similarity reaches its threshold.
    thresholds: {
      semantic: number("RANK_THRESHOLD_SEMANTIC", provider === "openai" ? 0.5 : 0.3, 0, 1),
      distance: number("RANK_THRESHOLD_DISTANCE", 0.5, 0, 1),
      time: number("RANK_THRESHOLD_TIME", 0.6, 0, 1),
      reward: number("RANK_THRESHOLD_REWARD", 0.75, 0, 1),
    },
    // Distance similarity is exp(-metres / scale): 1 at the pickup, about 0.5 at 0.7 × scale.
    distanceScaleMetres: positiveInteger("RANK_DISTANCE_SCALE_METRES", 800),
    // How many of the courier's most recent deliveries make up their history.
    historySize: positiveInteger("RANK_HISTORY_SIZE", 50),
    timeZone: process.env.RANK_TIME_ZONE ?? "Asia/Singapore",
  },
};
