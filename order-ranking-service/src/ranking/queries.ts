/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
 * Scope: Loading open orders, the courier's past orders and preferences for ranking,
 * and reading and saving preferences. Author review: Pending.
 * Claude Code (Opus 5.5), 2026-11-01. Scope: History is only orders the courier has
 * delivered. Author review: Pending.
 */
import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { orders, preferences, suppliers } from "../db/schema.js";
import { HttpError } from "../errors.js";
import { requestEmbedding } from "./embedding-job.js";
import { rankOrders, type Place, type Preferences } from "./score.js";

// order-service moves an order PICKED_UP -> DELIVERED -> COMPLETE -> SETTLED; from
// DELIVERED on, the courier has delivered it.
export const DELIVERED_STATES = ["DELIVERED", "COMPLETE", "SETTLED"];

function place(latitude: number | null, longitude: number | null): Place | null {
  return latitude === null || longitude === null ? null : { latitude, longitude };
}

export async function getPreferences(userId: number): Promise<Preferences | null> {
  const [row] = await db.select().from(preferences).where(eq(preferences.userId, userId));
  if (!row) return null;
  return {
    supplierTypes: row.supplierTypes,
    buildings: row.buildings,
    minReward: row.minReward,
    note: row.note,
    noteEmbedding: row.noteEmbedding,
  };
}

export interface PreferencesInput {
  supplierTypes: string[];
  buildings: string[];
  minReward: number | null;
  note: string | null;
}

function stringList(value: unknown, what: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 50 || value.some((item) => typeof item !== "string" || !item.trim() || item.length > 256)) {
    throw new HttpError(400, `${what} must be a list of up to 50 names`);
  }
  return [...new Set(value.map((item: string) => item.trim()))];
}

export function parsePreferences(body: unknown): PreferencesInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "Request body must be an object");
  const fields = body as Record<string, unknown>;
  const minReward = fields.minReward ?? null;
  if (minReward !== null && (typeof minReward !== "number" || !Number.isSafeInteger(minReward) || minReward <= 0 || minReward > 2_147_483_647)) {
    throw new HttpError(400, "minReward must be a positive whole number");
  }
  const note = fields.note ?? null;
  if (note !== null && (typeof note !== "string" || note.length > 500)) {
    throw new HttpError(400, "note must be text of at most 500 characters");
  }
  return {
    supplierTypes: stringList(fields.supplierTypes, "supplierTypes"),
    buildings: stringList(fields.buildings, "buildings"),
    minReward,
    note: typeof note === "string" && note.trim() ? note.trim() : null,
  };
}

// The note is embedded in the background; a changed note drops its old embedding.
export async function savePreferences(userId: number, input: PreferencesInput): Promise<void> {
  await db.insert(preferences).values({ userId, ...input })
    .onConflictDoUpdate({
      target: preferences.userId,
      set: {
        supplierTypes: input.supplierTypes,
        buildings: input.buildings,
        minReward: input.minReward,
        note: input.note,
        noteEmbedding: sql`case when ${preferences.note} is not distinct from excluded.note then ${preferences.noteEmbedding} else null end`,
        noteEmbeddingAttempts: sql`case when ${preferences.note} is not distinct from excluded.note then ${preferences.noteEmbeddingAttempts} else 0 end`,
        noteEmbeddingRetryAt: sql`case when ${preferences.note} is not distinct from excluded.note then ${preferences.noteEmbeddingRetryAt} else null end`,
        updatedAt: sql`now()`,
      },
    });
  void requestEmbedding();
}

export function parseLocation(query: Record<string, unknown>): Place | null {
  const { lat, lng } = query;
  if (lat === undefined && lng === undefined) return null;
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (typeof lat !== "string" || typeof lng !== "string" || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new HttpError(400, "lat and lng must both be given as coordinates");
  }
  return { latitude, longitude };
}

export function parseLimit(value: unknown): number {
  if (value === undefined) return 24;
  const limit = Number(value);
  if (typeof value !== "string" || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new HttpError(400, "limit must be a whole number from 1 to 100");
  }
  return limit;
}

// Open orders the courier could accept (not their own), ranked for them.
export async function rankOpenOrders(userId: number, location: Place | null, limit: number, now = new Date()) {
  const [candidates, history, prefs] = await Promise.all([
    db.select({
      id: orders.id,
      title: orders.title,
      creditReward: orders.creditReward,
      createdAt: orders.createdAt,
      embedding: orders.embedding,
      supplierName: suppliers.name,
      supplierType: suppliers.type,
      buildingName: suppliers.buildingName,
      latitude: suppliers.latitude,
      longitude: suppliers.longitude,
    })
      .from(orders)
      .leftJoin(suppliers, eq(orders.supplierId, suppliers.id))
      .where(and(eq(orders.state, "OPEN"), ne(orders.requesterId, userId))),
    // Orders the courier has delivered, most recent first. Accepted orders that are not
    // delivered yet are left out, since reasons call these "orders you've delivered".
    db.select({
      id: orders.id,
      title: orders.title,
      acceptedAt: orders.acceptedAt,
      embedding: orders.embedding,
      supplierType: suppliers.type,
      latitude: suppliers.latitude,
      longitude: suppliers.longitude,
    })
      .from(orders)
      .leftJoin(suppliers, eq(orders.supplierId, suppliers.id))
      .where(and(eq(orders.courierId, userId), inArray(orders.state, DELIVERED_STATES), isNotNull(orders.acceptedAt)))
      .orderBy(desc(orders.acceptedAt))
      .limit(config.ranking.historySize),
    getPreferences(userId),
  ]);

  const ranked = rankOrders({
    candidates: candidates.map((row) => ({
      id: row.id,
      title: row.title,
      creditReward: row.creditReward,
      createdAt: row.createdAt,
      embedding: row.embedding,
      supplier: { name: row.supplierName, type: row.supplierType, buildingName: row.buildingName, place: place(row.latitude, row.longitude) },
    })),
    history: history.map((row) => ({
      id: row.id,
      title: row.title,
      acceptedAt: row.acceptedAt,
      embedding: row.embedding,
      supplier: { type: row.supplierType, place: place(row.latitude, row.longitude) },
    })),
    preferences: prefs,
    location,
    now,
  }, config.ranking);

  return {
    items: ranked.slice(0, limit),
    context: {
      // Whether anything about this courier shaped the order, or it is only reward and recency.
      personalised: history.length > 0 || prefs !== null || location !== null,
      pastOrders: history.length,
      location: location ? "current" : history.length >= 3 ? "usual" : null,
      embeddingProvider: config.embedding.provider,
      // Orders still waiting for an embedding are ranked without the meaning part.
      unembeddedOrders: candidates.filter((row) => !row.embedding).length,
    },
  };
}
