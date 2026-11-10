/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
 * Scope: Text embedding providers (OpenAI embeddings API, and a keyless hashing
 * fallback for local development and tests) and the vector helpers used for ranking.
 * Author review: Pending.
 */
import { config } from "../config.js";
import { EMBEDDING_DIMENSIONS } from "../db/schema.js";

export type Embedder = (texts: string[]) => Promise<number[][]>;

export class EmbeddingError extends Error {}

// POST /v1/embeddings; the response keeps the input order through `index`.
const openaiEmbedder: Embedder = async (texts) => {
  const response = await fetch(`${config.embedding.openaiBaseUrl}/embeddings`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.embedding.openaiApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: config.embedding.model, input: texts, dimensions: EMBEDDING_DIMENSIONS }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    // The body explains the failure (bad key, quota) and never contains the key.
    const detail = (await response.text()).slice(0, 300);
    throw new EmbeddingError(`OpenAI embeddings returned ${response.status}: ${detail}`);
  }
  const body = await response.json() as { data?: { index: number; embedding: number[] }[] };
  const vectors: number[][] = new Array(texts.length);
  for (const item of body.data ?? []) vectors[item.index] = item.embedding;
  if (vectors.length !== texts.length || vectors.some((vector) => vector?.length !== EMBEDDING_DIMENSIONS)) {
    throw new EmbeddingError("OpenAI embeddings returned an unexpected response");
  }
  return vectors;
};

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "for", "from", "get", "i", "in", "is", "it",
  "me", "my", "of", "on", "or", "pls", "please", "the", "to", "with", "you",
]);

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 1 && !STOP_WORDS.has(word)) ?? [];
}

// 32-bit FNV-1a.
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

// Word and word-pair counts hashed into 1536 slots. It only captures shared words
// ("bubble tea" ~ "tea"), not meaning, but needs no key or network.
export function hashingEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = words(text);
  const features = [...tokens, ...tokens.slice(1).map((word, i) => `${tokens[i]} ${word}`)];
  for (const feature of features) {
    const h = hash(feature);
    vector[h % EMBEDDING_DIMENSIONS]! += (h & 0x80000000) ? -1 : 1;
  }
  return normalize(vector);
}

const hashingEmbedder: Embedder = async (texts) => texts.map(hashingEmbedding);

let embedder: Embedder = config.embedding.provider === "openai" ? openaiEmbedder : hashingEmbedder;

export function embed(texts: string[]): Promise<number[][]> {
  return embedder(texts);
}

// Tests replace the provider.
export function setEmbedder(replacement: Embedder): void {
  embedder = replacement;
}

export function normalize(vector: number[]): number[] {
  const length = Math.hypot(...vector);
  return length === 0 ? vector : vector.map((value) => value / length);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    aa += a[i]! * a[i]!;
    bb += b[i]! * b[i]!;
  }
  return aa === 0 || bb === 0 ? 0 : dot / Math.sqrt(aa * bb);
}

// The text an order is embedded from. The pickup place adds meaning a short title lacks
// ("Gong Cha" says bubble tea even when the title only says "drink").
export function orderText(order: { title: string; description: string }, supplier?: { name: string | null; type: string | null }): string {
  const pickup = supplier?.name ? `\nPickup: ${supplier.name}${supplier.type ? ` (${supplier.type})` : ""}` : "";
  return `${order.title}\n${order.description}${pickup}`;
}
