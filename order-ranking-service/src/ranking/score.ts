/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
 * Scope: Explainable order ranking. Each open order is compared with the courier in
 * separate parts (meaning, time of day, distance, preferences, reward); each part
 * gives a similarity from 0 to 1, the score is their weighted average, and every part
 * that reaches its threshold becomes a reason shown to the courier. Pure functions,
 * so the ranking can be tested without a database. Author review: Pending.
 * Claude Code (Opus 5.5), 2026-11-01. Scope: The time reason only says "orders like
 * this" when both orders have embeddings that are similar. Author review: Pending.
 */
import { cosine } from "./embeddings.js";

export interface Place {
  latitude: number;
  longitude: number;
}

export interface CandidateOrder {
  id: string;
  title: string;
  creditReward: number;
  createdAt: Date;
  embedding: number[] | null;
  supplier: { name: string | null; type: string | null; buildingName: string | null; place: Place | null };
}

export interface PastOrder {
  id: string;
  title: string;
  acceptedAt: Date | null;
  embedding: number[] | null;
  supplier: { type: string | null; place: Place | null };
}

export interface Preferences {
  supplierTypes: string[];
  buildings: string[];
  minReward: number | null;
  note: string | null;
  noteEmbedding: number[] | null;
}

export interface RankingSettings {
  weights: Record<PartName, number>;
  thresholds: { semantic: number; distance: number; time: number; reward: number };
  distanceScaleMetres: number;
  timeZone: string;
}

export const PART_NAMES = ["semantic", "distance", "time", "preference", "reward"] as const;
export type PartName = (typeof PART_NAMES)[number];

export interface Reason {
  part: PartName;
  text: string;
}

export interface Part {
  similarity: number;
  weight: number;
}

export interface RankedOrder {
  orderId: string;
  score: number;
  parts: Partial<Record<PartName, Part>>;
  reasons: Reason[];
}

export interface RankingInput {
  candidates: CandidateOrder[];
  history: PastOrder[];
  preferences: Preferences | null;
  // The courier's location from the browser; without it, their usual pickup area is used.
  location: Place | null;
  now: Date;
}

const EARTH_RADIUS_METRES = 6_371_000;

export function distanceMetres(a: Place, b: Place): number {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Hour of day as a fraction (13.5 = 1:30pm) in the campus time zone.
export function hourOfDay(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value("hour") + value("minute") / 60;
}

// Time of day as a point on a circle, (sin, cos), so 11pm and 1am are close. For two
// such points, (1 + cos Δ) / 2 is 1 at the same time and 0 twelve hours apart; the
// power narrows it to roughly ±2 hours (0.9 at 1 h, 0.66 at 2 h, 0.39 at 3 h).
export function timeSimilarity(hourA: number, hourB: number): number {
  const angle = (hourA - hourB) * 2 * Math.PI / 24;
  return ((1 + Math.cos(angle)) / 2) ** 6;
}

function formatHour(hour: number): string {
  const rounded = Math.round(hour) % 24;
  const suffix = rounded < 12 ? "am" : "pm";
  return `${rounded % 12 === 0 ? 12 : rounded % 12}${suffix}`;
}

function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1)} km`;
}

function quote(text: string, max = 40): string {
  return `"${text.length > max ? `${text.slice(0, max - 1)}…` : text}"`;
}

function centroid(places: Place[]): Place | null {
  if (places.length === 0) return null;
  return {
    latitude: places.reduce((sum, place) => sum + place.latitude, 0) / places.length,
    longitude: places.reduce((sum, place) => sum + place.longitude, 0) / places.length,
  };
}

// Similar past deliveries and a similar preference note both count; the closest one is
// named in the reason, so the courier can see what it was compared with.
function semanticPart(order: CandidateOrder, history: PastOrder[], preferences: Preferences | null, threshold: number) {
  if (!order.embedding) return null;
  const pastSimilarities = history
    .filter((past) => past.embedding)
    .map((past) => ({ past, similarity: Math.max(0, cosine(order.embedding!, past.embedding!)) }));
  const noteSimilarity = preferences?.note && preferences.noteEmbedding
    ? Math.max(0, cosine(order.embedding, preferences.noteEmbedding))
    : null;
  if (pastSimilarities.length === 0 && noteSimilarity === null) return null;

  const best = pastSimilarities.reduce((top, item) => item.similarity > top.similarity ? item : top, { past: null as PastOrder | null, similarity: 0 });
  const similarity = Math.max(best.similarity, noteSimilarity ?? 0);
  const reasons: Reason[] = [];
  if (similarity >= threshold) {
    if (noteSimilarity !== null && noteSimilarity >= best.similarity) {
      reasons.push({ part: "semantic", text: `Matches what you said you like: ${quote(preferences!.note!)}` });
    } else if (best.past) {
      const alike = pastSimilarities.filter((item) => item.similarity >= threshold).length;
      reasons.push({
        part: "semantic",
        text: alike > 1
          ? `Like ${alike} orders you've delivered, such as ${quote(best.past.title)}`
          : `Like ${quote(best.past.title)}, which you delivered`,
      });
    }
  }
  return { similarity, reasons };
}

function distancePart(order: CandidateOrder, origin: { place: Place; usual: boolean } | null, settings: RankingSettings) {
  if (!origin || !order.supplier.place) return null;
  const metres = distanceMetres(origin.place, order.supplier.place);
  const similarity = Math.exp(-metres / settings.distanceScaleMetres);
  const reasons: Reason[] = [];
  if (similarity >= settings.thresholds.distance) {
    const where = order.supplier.name ? `${order.supplier.name}${order.supplier.buildingName ? ` (${order.supplier.buildingName})` : ""}` : "The pickup";
    reasons.push({
      part: "distance",
      text: origin.usual
        ? `${where} is ${formatDistance(metres)} from where you usually pick up`
        : `${where} is ${formatDistance(metres)} from you`,
    });
  }
  return { similarity, reasons };
}

// How well now fits the hours the courier has taken orders, counting past orders that
// are similar to this one more (so a courier who does coffee in the morning and lunch at
// noon gets each at its own time). Needs at least three past orders.
function timePart(order: CandidateOrder, history: PastOrder[], nowHour: number, settings: RankingSettings) {
  const timed = history.filter((past) => past.acceptedAt);
  if (timed.length < 3) return null;

  let total = 0;
  let weights = 0;
  let similarAndTimed = 0;
  for (const past of timed) {
    const compared = order.embedding && past.embedding ? Math.max(0, cosine(order.embedding, past.embedding)) : null;
    // Without both embeddings every past order counts equally, but they are not called alike.
    const likeness = compared ?? 1;
    // Every past order counts a little, so an order unlike any before still gets a time score.
    const weight = 0.2 + likeness;
    const fit = timeSimilarity(nowHour, hourOfDay(past.acceptedAt!, settings.timeZone));
    total += weight * fit;
    weights += weight;
    if (compared !== null && compared >= settings.thresholds.semantic && fit >= settings.thresholds.time) similarAndTimed++;
  }
  const similarity = total / weights;
  const reasons: Reason[] = [];
  if (similarity >= settings.thresholds.time) {
    reasons.push({
      part: "time",
      text: similarAndTimed > 0
        ? `You often take orders like this around ${formatHour(nowHour)}`
        : `You often take orders around ${formatHour(nowHour)}`,
    });
  }
  return { similarity, reasons };
}

// Explicit preferences when the courier has set any; otherwise the supplier types they
// deliver from most (at least 3 past orders, 40% or more of them).
function preferencePart(order: CandidateOrder, history: PastOrder[], preferences: Preferences | null) {
  const reasons: Reason[] = [];
  const explicit = preferences && (preferences.supplierTypes.length > 0 || preferences.buildings.length > 0 || preferences.minReward !== null);
  if (explicit) {
    let checks = 0;
    let matches = 0;
    if (preferences.supplierTypes.length > 0) {
      checks++;
      if (order.supplier.type && preferences.supplierTypes.includes(order.supplier.type)) {
        matches++;
        reasons.push({ part: "preference", text: `${order.supplier.type} is one of your preferred types` });
      }
    }
    if (preferences.buildings.length > 0) {
      checks++;
      if (order.supplier.buildingName && preferences.buildings.includes(order.supplier.buildingName)) {
        matches++;
        reasons.push({ part: "preference", text: `Pickup is in ${order.supplier.buildingName}, one of your buildings` });
      }
    }
    if (preferences.minReward !== null) {
      checks++;
      if (order.creditReward >= preferences.minReward) {
        matches++;
        reasons.push({ part: "preference", text: `Pays at least your minimum of ${preferences.minReward} credits` });
      }
    }
    return { similarity: matches / checks, reasons };
  }

  const typed = history.filter((past) => past.supplier.type);
  if (typed.length < 3 || !order.supplier.type) return null;
  const share = typed.filter((past) => past.supplier.type === order.supplier.type).length / typed.length;
  if (share >= 0.4) reasons.push({ part: "preference", text: `You often deliver from ${order.supplier.type} places` });
  return { similarity: share, reasons };
}

// Position among the open orders by reward: 1 for the highest, 0 for the lowest.
function rewardParts(candidates: CandidateOrder[], threshold: number): Map<string, { similarity: number; reasons: Reason[] }> {
  const rewards = candidates.map((order) => order.creditReward).sort((a, b) => a - b);
  const parts = new Map<string, { similarity: number; reasons: Reason[] }>();
  for (const order of candidates) {
    const below = rewards.filter((reward) => reward < order.creditReward).length;
    const similarity = rewards.length > 1 ? below / (rewards.length - 1) : 0.5;
    const reasons: Reason[] = rewards.length >= 4 && similarity >= threshold
      ? [{ part: "reward", text: `Pays more than most open orders (${order.creditReward} credits)` }]
      : [];
    parts.set(order.id, { similarity, reasons });
  }
  return parts;
}

export function rankOrders(input: RankingInput, settings: RankingSettings): RankedOrder[] {
  const nowHour = hourOfDay(input.now, settings.timeZone);
  const usualPlace = centroid(input.history.flatMap((past) => past.supplier.place ? [past.supplier.place] : []));
  const origin = input.location
    ? { place: input.location, usual: false }
    : usualPlace && input.history.length >= 3 ? { place: usualPlace, usual: true } : null;
  const rewards = rewardParts(input.candidates, settings.thresholds.reward);

  const ranked = input.candidates.map((order): RankedOrder & { createdAt: number } => {
    const computed: Partial<Record<PartName, { similarity: number; reasons: Reason[] } | null>> = {
      semantic: semanticPart(order, input.history, input.preferences, settings.thresholds.semantic),
      distance: distancePart(order, origin, settings),
      time: timePart(order, input.history, nowHour, settings),
      preference: preferencePart(order, input.history, input.preferences),
      reward: rewards.get(order.id) ?? null,
    };

    const parts: Partial<Record<PartName, Part>> = {};
    const reasons: Reason[] = [];
    let total = 0;
    let weights = 0;
    for (const name of PART_NAMES) {
      const part = computed[name];
      const weight = settings.weights[name];
      if (!part || weight === 0) continue;
      parts[name] = { similarity: round(part.similarity), weight };
      total += weight * part.similarity;
      weights += weight;
      reasons.push(...part.reasons);
    }
    // Strongest parts first, so the first reason is the main one.
    reasons.sort((a, b) => (parts[b.part]!.similarity * parts[b.part]!.weight) - (parts[a.part]!.similarity * parts[a.part]!.weight));
    return { orderId: order.id, score: round(weights > 0 ? total / weights : 0), parts, reasons, createdAt: order.createdAt.getTime() };
  });

  // Ties (e.g. a new courier with no history) fall back to newest first.
  ranked.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
  return ranked.map(({ createdAt: _createdAt, ...item }) => item);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
