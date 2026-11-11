/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-11-11.
 * Scope: The OpenAI embeddings client against a local stand-in server: request shape,
 * `dimensions` on and off, response order and validation, vector length against the pgvector
 * columns; the embedding configuration rules, including deploy.sh's production settings; and
 * the deploy-time embeddings:check script. No database or real provider is used.
 * Author review: Pending.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { after, before, beforeEach, test } from "node:test";

const run = promisify(execFile);
const JWT_SECRET = randomBytes(32).toString("hex");
const API_KEY = `test-key-${randomBytes(8).toString("hex")}`;
const DIMENSIONS = 1536;

// Each request is recorded; `reply` decides the response (default: 1536-long vectors).
const calls = [];
let reply;
let server, baseUrl, openAiCompatibleEmbedder;

const vector = (seed, length = DIMENSIONS) => Array.from({ length }, (_, i) => Math.sin(seed + i));

before(async () => {
  server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    calls.push({ method: req.method, path: req.url, auth: req.headers.authorization, body: parsed });
    const [status, payload] = reply(parsed);
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(payload));
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

  process.env.JWT_SECRET = JWT_SECRET;
  delete process.env.OPENAI_API_KEY;
  delete process.env.EMBEDDING_PROVIDER;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.EMBEDDING_MODEL;
  ({ openAiCompatibleEmbedder } = await import("../dist/ranking/embeddings.js"));
});

beforeEach(() => {
  calls.length = 0;
  reply = ({ input }) => [200, { object: "list", data: input.map((_, index) => ({ object: "embedding", index, embedding: vector(index) })) }];
});

after(() => server?.close());

function embedder(overrides = {}) {
  return openAiCompatibleEmbedder({ baseUrl, apiKey: API_KEY, model: "test-embedding-model", sendDimensions: true, ...overrides });
}

test("sends an OpenAI-compatible request with the configured model, key and dimensions", async () => {
  const vectors = await embedder()(["first", "second"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].path, "/v1/embeddings");
  assert.equal(calls[0].auth, `Bearer ${API_KEY}`);
  assert.deepEqual(calls[0].body, { model: "test-embedding-model", input: ["first", "second"], dimensions: DIMENSIONS });
  assert.deepEqual(vectors, [vector(0), vector(1)]);
});

test("leaves out dimensions when turned off", async () => {
  await embedder({ sendDimensions: false })(["only"]);
  assert.deepEqual(calls[0].body, { model: "test-embedding-model", input: ["only"] });
});

test("puts embeddings back in input order by index", async () => {
  reply = ({ input }) => [200, { data: input.map((_, index) => ({ index, embedding: vector(index) })).reverse() }];
  assert.deepEqual(await embedder()(["a", "b", "c"]), [vector(0), vector(1), vector(2)]);
});

test("rejects a vector of another length, naming both lengths", async () => {
  reply = ({ input }) => [200, { data: input.map((_, index) => ({ index, embedding: vector(index, 1024) })) }];
  await assert.rejects(embedder()(["a"]), /returned 1024-dimensional embeddings; the database stores 1536/);
});

test("rejects base64 embeddings, missing items and out-of-range indexes", async () => {
  reply = () => [200, { data: [{ index: 0, embedding: "AAAA" }] }];
  await assert.rejects(embedder()(["a"]), /not a list of numbers/);
  reply = () => [200, { data: [{ index: 0, embedding: vector(0) }] }];
  await assert.rejects(embedder()(["a", "b"]), /no embedding for input 1/);
  reply = () => [200, { data: [{ index: 5, embedding: vector(0) }] }];
  await assert.rejects(embedder()(["a"]), /unexpected index: 5/);
  reply = () => [200, {}];
  await assert.rejects(embedder()(["a"]), /no embedding for input 0/);
});

test("reports the provider's error with the status, URL and model, without the key", async () => {
  reply = () => [403, { error: { message: "Model is not available for embeddings" } }];
  const error = await embedder()(["a"]).catch((caught) => caught);
  assert.match(error.message, /Embeddings API \(http:\/\/127\.0\.0\.1:\d+\/v1\/embeddings, model test-embedding-model\) returned 403: .*not available for embeddings/);
  assert.ok(!error.message.includes(API_KEY));
});

// config.js validates at import, so each case runs in a fresh process.
async function loadConfig(env) {
  const script = "const { config } = await import('./dist/config.js'); console.log(JSON.stringify(config.embedding));";
  try {
    const { stdout } = await run(process.execPath, ["--input-type=module", "-e", script], {
      env: { PATH: process.env.PATH, JWT_SECRET, ...env },
    });
    return { config: JSON.parse(stdout) };
  } catch (error) {
    return { error: error.stderr };
  }
}

test("configuration: keyless local use still falls back to hashing", async () => {
  const { config } = await loadConfig({});
  assert.equal(config.provider, "hashing");
});

test("configuration: deploy.sh's production settings give OpenAI text-embedding-3-small at 1536", async () => {
  // As set by deploy_ranking_service, with OPENAI_API_KEY from the openai-api-key secret.
  const production = { EMBEDDING_PROVIDER: "openai", OPENAI_API_KEY: API_KEY, OPENAI_BASE_URL: "https://api.openai.com/v1", EMBEDDING_MODEL: "text-embedding-3-small" };
  const { config } = await loadConfig(production);
  assert.equal(config.provider, "openai");
  assert.equal(config.openaiBaseUrl, "https://api.openai.com/v1");
  assert.equal(config.model, "text-embedding-3-small");
  assert.equal(config.sendDimensions, true);
  // Without the key it stops at startup rather than falling back to hashing.
  assert.match((await loadConfig({ ...production, OPENAI_API_KEY: "" })).error, /OPENAI_API_KEY is required/);
});

test("configuration: another OpenAI-compatible base URL needs an explicit model", async () => {
  const compatible = { EMBEDDING_PROVIDER: "openai", OPENAI_API_KEY: API_KEY, OPENAI_BASE_URL: "https://embeddings.example.test/v1/" };
  assert.match((await loadConfig(compatible)).error, /EMBEDDING_MODEL is required .*GET https:\/\/embeddings\.example\.test\/v1\/models/);
  const { config } = await loadConfig({ ...compatible, EMBEDDING_MODEL: "an-embedding-model" });
  assert.equal(config.openaiBaseUrl, "https://embeddings.example.test/v1");
  assert.equal(config.model, "an-embedding-model");
  assert.equal((await loadConfig({ ...compatible, EMBEDDING_MODEL: "m", EMBEDDING_SEND_DIMENSIONS: "false" })).config.sendDimensions, false);
  assert.match((await loadConfig({ ...compatible, EMBEDDING_MODEL: "m", EMBEDDING_SEND_DIMENSIONS: "no" })).error, /EMBEDDING_SEND_DIMENSIONS must be true or false/);
});

test("configuration: the openai provider without a key fails instead of hashing", async () => {
  assert.match((await loadConfig({ EMBEDDING_PROVIDER: "openai", EMBEDDING_MODEL: "m" })).error, /OPENAI_API_KEY is required/);
  // OpenAI's own API keeps its default model.
  assert.equal((await loadConfig({ OPENAI_API_KEY: API_KEY })).config.model, "text-embedding-3-small");
});

async function check(env) {
  try {
    const { stdout } = await run(process.execPath, ["dist/check-embeddings.js"], {
      env: { PATH: process.env.PATH, JWT_SECRET, ...env },
    });
    return { ok: true, output: stdout };
  } catch (error) {
    return { ok: false, output: error.stderr };
  }
}

test("embeddings:check passes with 1536-long vectors and fails otherwise", async () => {
  const env = { EMBEDDING_PROVIDER: "openai", OPENAI_API_KEY: API_KEY, OPENAI_BASE_URL: baseUrl, EMBEDDING_MODEL: "test-embedding-model" };
  const passed = await check(env);
  assert.ok(passed.ok, passed.output);
  assert.match(passed.output, /model test-embedding-model .* returned 1536 dimensions/);

  reply = ({ input }) => [200, { data: input.map((_, index) => ({ index, embedding: vector(index, 768) })) }];
  const wrongLength = await check(env);
  assert.equal(wrongLength.ok, false);
  assert.match(wrongLength.output, /768-dimensional/);

  const hashing = await check({});
  assert.equal(hashing.ok, false);
  assert.match(hashing.output, /hashing embedder is for development only/);
});
