/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
 * Scope: Unit tests for the explainable ranking: each part's similarity, thresholds
 * deciding which reasons are shown, and the weighted score. Author review: Pending.
 * Claude Code (Opus 5.5), 2026-11-01. Scope: Time reasons without embeddings. Author review: Pending.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.JWT_SECRET ??= "x".repeat(32);
process.env.EMBEDDING_PROVIDER = "hashing";
const { distanceMetres, hourOfDay, rankOrders, timeSimilarity } = await import("../dist/ranking/score.js");
const { cosine, hashingEmbedding } = await import("../dist/ranking/embeddings.js");

const SETTINGS = {
  weights: { semantic: 0.4, distance: 0.25, time: 0.15, preference: 0.15, reward: 0.05 },
  thresholds: { semantic: 0.3, distance: 0.5, time: 0.6, reward: 0.75 },
  distanceScaleMetres: 800,
  timeZone: "Asia/Singapore",
};

const COM2 = { latitude: 1.2942, longitude: 103.7736 };
const UTOWN = { latitude: 1.3048, longitude: 103.7727 };
// 12:30 in Singapore.
const NOON = new Date("2026-10-30T04:30:00Z");

function candidate(id, overrides = {}) {
  return {
    id,
    title: `Order ${id}`,
    creditReward: 5,
    createdAt: new Date("2026-10-30T04:00:00Z"),
    embedding: null,
    supplier: { name: "Cool Spot", type: "Food/Coffee", buildingName: "COM2", place: COM2 },
    ...overrides,
  };
}

function past(id, text, acceptedAt, overrides = {}) {
  return { id, title: text, acceptedAt, embedding: hashingEmbedding(text), supplier: { type: "Food/Coffee", place: COM2 }, ...overrides };
}

test("time of day is circular: 11pm is close to 1am, and similarity falls off within hours", () => {
  assert.equal(timeSimilarity(12, 12), 1);
  assert.ok(timeSimilarity(23, 1) > 0.6);
  assert.ok(timeSimilarity(12, 13) > 0.85);
  assert.ok(timeSimilarity(12, 15) < 0.45);
  assert.ok(timeSimilarity(0, 12) < 0.0001);
  assert.equal(hourOfDay(NOON, "Asia/Singapore"), 12.5);
});

test("distance between two NUS buildings is about a kilometre", () => {
  const metres = distanceMetres(COM2, UTOWN);
  assert.ok(metres > 1100 && metres < 1250, String(metres));
});

test("the hashing embedding scores shared words higher than unrelated text", () => {
  const tea = hashingEmbedding("Bubble tea from Gong Cha");
  assert.ok(cosine(tea, hashingEmbedding("Large bubble tea, less sugar")) > cosine(tea, hashingEmbedding("Print my report at the library")));
});

test("a courier with no history, preferences or location gets reward order and no reasons", () => {
  const ranked = rankOrders({
    candidates: [candidate("a", { creditReward: 2 }), candidate("b", { creditReward: 9 })],
    history: [],
    preferences: null,
    location: null,
    now: NOON,
  }, SETTINGS);
  assert.deepEqual(ranked.map((item) => item.orderId), ["b", "a"]);
  assert.deepEqual(ranked.flatMap((item) => item.reasons), []);
  assert.deepEqual(Object.keys(ranked[0].parts), ["reward"]);
});

test("similar past deliveries at this hour and a nearby pickup rank an order first, with reasons", () => {
  const lunch = (day) => new Date(`2026-10-${day}T04:15:00Z`); // 12:15 Singapore
  const history = [
    past("p1", "Bubble tea from Gong Cha", lunch(20)),
    past("p2", "Gong Cha bubble tea less ice", lunch(22)),
    past("p3", "Bubble tea please", lunch(24)),
  ];
  const tea = candidate("tea", { title: "Gong Cha bubble tea", embedding: hashingEmbedding("Gong Cha bubble tea") });
  const print = candidate("print", {
    title: "Print my report",
    embedding: hashingEmbedding("Print my report at the library"),
    creditReward: 6,
    supplier: { name: "Printer", type: "Printing", buildingName: "UTown", place: UTOWN },
  });

  const ranked = rankOrders({ candidates: [print, tea], history, preferences: null, location: COM2, now: NOON }, SETTINGS);
  assert.equal(ranked[0].orderId, "tea");
  const reasons = ranked[0].reasons.map((reason) => reason.text);
  assert.ok(reasons.some((text) => text.startsWith("Like 3 orders you've delivered")), reasons.join(" | "));
  assert.ok(reasons.includes("Cool Spot (COM2) is 0 m from you"), reasons.join(" | "));
  assert.ok(reasons.includes("You often take orders like this around 1pm"), reasons.join(" | "));
  assert.ok(reasons.includes("You often deliver from Food/Coffee places"), reasons.join(" | "));

  // The unrelated, far order still has scores for each part, but no reasons pass the thresholds.
  const other = ranked[1];
  assert.equal(other.orderId, "print");
  assert.ok(other.parts.semantic.similarity < SETTINGS.thresholds.semantic);
  assert.ok(other.parts.distance.similarity < SETTINGS.thresholds.distance);
  assert.deepEqual(other.reasons.filter((reason) => reason.part !== "time"), []);
});

test("without a current location, distance is measured from the courier's usual pickup area", () => {
  const history = [1, 2, 3].map((n) => past(`p${n}`, "Coffee", new Date("2026-10-20T01:00:00Z")));
  const [ranked] = rankOrders({ candidates: [candidate("a")], history, preferences: null, location: null, now: NOON }, SETTINGS);
  assert.ok(ranked.reasons.some((reason) => reason.text === "Cool Spot (COM2) is 0 m from where you usually pick up"));
});

test("explicit preferences replace the learnt type preference and each match is a reason", () => {
  const preferences = { supplierTypes: ["Food/Coffee"], buildings: ["UTown"], minReward: 4, note: null, noteEmbedding: null };
  const [ranked] = rankOrders({ candidates: [candidate("a")], history: [], preferences, location: null, now: NOON }, SETTINGS);
  assert.equal(ranked.parts.preference.similarity, 0.667);
  assert.deepEqual(ranked.reasons.map((reason) => reason.text).sort(), [
    "Food/Coffee is one of your preferred types",
    "Pays at least your minimum of 4 credits",
  ]);
});

test("a preference note works like a past order for meaning", () => {
  const note = "bubble tea runs";
  const preferences = { supplierTypes: [], buildings: [], minReward: null, note, noteEmbedding: hashingEmbedding(note) };
  const [ranked] = rankOrders({
    candidates: [candidate("a", { embedding: hashingEmbedding("Two bubble tea") })],
    history: [],
    preferences,
    location: null,
    now: NOON,
  }, SETTINGS);
  assert.deepEqual(ranked.reasons.map((reason) => reason.text), ['Matches what you said you like: "bubble tea runs"']);
});

test("the score is the weighted average of the parts that have data", () => {
  const [ranked] = rankOrders({
    candidates: [candidate("a", { creditReward: 9 }), candidate("b", { creditReward: 1 })],
    history: [],
    preferences: null,
    location: COM2,
    now: NOON,
  }, SETTINGS);
  // distance 1 (weight 0.25) and reward 1 (weight 0.05).
  assert.equal(ranked.score, 1);
  assert.deepEqual(Object.keys(ranked.parts).sort(), ["distance", "reward"]);
});

test("without embeddings, the time reason does not claim the orders are alike", () => {
  // Unrelated coffee runs at this hour, and a printing order; nothing has been embedded yet.
  const history = [1, 2, 3].map((n) => past(`p${n}`, "Coffee delivery", NOON, { embedding: null }));
  const print = candidate("print", { title: "Print my thesis", supplier: { name: "Print shop", type: "Printing", buildingName: "COM2", place: null } });
  const [ranked] = rankOrders({ candidates: [print], history, preferences: null, location: null, now: NOON }, SETTINGS);
  // The time part still scores the hour, but only says when the courier usually takes orders.
  assert.equal(ranked.parts.time.similarity, 1);
  assert.deepEqual(ranked.reasons.filter((reason) => reason.part === "time").map((reason) => reason.text), ["You often take orders around 1pm"]);
});

test("the time reason says \"like this\" only when the order and a past order at this hour are similar", () => {
  const history = [1, 2, 3].map((n) => past(`p${n}`, "Bubble tea from Gong Cha", NOON));
  const timeReasons = (order) => rankOrders({ candidates: [order], history, preferences: null, location: null, now: NOON }, SETTINGS)[0]
    .reasons.filter((reason) => reason.part === "time").map((reason) => reason.text);

  assert.deepEqual(timeReasons(candidate("tea", { embedding: hashingEmbedding("Gong Cha bubble tea") })), ["You often take orders like this around 1pm"]);
  assert.deepEqual(timeReasons(candidate("print", { embedding: hashingEmbedding("Print my report at the library") })), ["You often take orders around 1pm"]);
  // Only the candidate has a vector; there is nothing to compare it with.
  const unembedded = history.map((item) => ({ ...item, embedding: null }));
  const [ranked] = rankOrders({ candidates: [candidate("tea", { embedding: hashingEmbedding("Gong Cha bubble tea") })], history: unembedded, preferences: null, location: null, now: NOON }, SETTINGS);
  assert.deepEqual(ranked.reasons.filter((reason) => reason.part === "time").map((reason) => reason.text), ["You often take orders around 1pm"]);
});
