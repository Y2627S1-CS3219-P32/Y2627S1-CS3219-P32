// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
// Scope: Server-side client for order-ranking-service, forwarding the user's bearer token,
// mirroring the order-service client. Author review: Pending.
import type { H3Event } from "h3";
import type { RankingPreferences, RankingResponse } from "#shared/services/order-ranking-service/types";

const FORWARDED_STATUSES = new Set([400, 401, 403, 404]);

function options(event: H3Event) {
  const token = getCookie(event, "user_access_token");
  if (!token) throw createError({ statusCode: 401, message: "A login is required." });
  return {
    baseURL: useRuntimeConfig(event).orderRankingServiceBaseUrl,
    headers: { authorization: `Bearer ${token}` },
    timeout: 5000,
    retry: 0 as const,
  };
}

function toRankingServiceError(error: unknown) {
  if (typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" && FORWARDED_STATUSES.has(error.statusCode)) {
    const data = "data" in error ? error.data : undefined;
    const message = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
      ? data.error
      : "The request was rejected.";
    return createError({ statusCode: error.statusCode, message, data: { error: message } });
  }
  const message = "Suggestions are temporarily unavailable. The other tabs still work.";
  return createError({ statusCode: 502, message, data: { error: message } });
}

async function call<T>(event: H3Event, path: string, init: Record<string, unknown> = {}): Promise<T> {
  const base = options(event);
  try {
    return (await $fetch(path, { ...base, ...init })) as T;
  } catch (error) {
    throw toRankingServiceError(error);
  }
}

// Only lat, lng and limit are forwarded.
export function rankingQuery(event: H3Event): Record<string, string> {
  const query = getQuery(event);
  return Object.fromEntries((["lat", "lng", "limit"] as const).flatMap((key) =>
    typeof query[key] === "string" && query[key] ? [[key, query[key]]] : []));
}

export const getRankings = (event: H3Event, query: Record<string, string>) => call<RankingResponse>(event, "/rankings", { query });
export const getPreferences = (event: H3Event) => call<RankingPreferences>(event, "/preferences/me");
export const savePreferences = (event: H3Event, body: unknown) => call<RankingPreferences>(event, "/preferences/me", { method: "PUT", body });
