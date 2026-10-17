// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
// Scope: Server-side client for notification-service, forwarding the user's bearer token.
// Author review: Pending.
import type { H3Event } from "h3";

const FORWARDED_STATUSES = new Set([400, 401]);

export async function callNotificationService<T>(event: H3Event, path: string, init: Record<string, unknown> = {}): Promise<T> {
  const token = getCookie(event, "user_access_token");
  if (!token) throw createError({ statusCode: 401, message: "A login is required." });
  try {
    return (await $fetch(path, {
      baseURL: useRuntimeConfig(event).notificationServiceBaseUrl,
      headers: { authorization: `Bearer ${token}` },
      timeout: 5000,
      retry: 0,
      ...init,
    })) as T;
  } catch (error) {
    const status = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined;
    if (typeof status === "number" && FORWARDED_STATUSES.has(status)) {
      const data = typeof error === "object" && error !== null && "data" in error ? error.data : undefined;
      const message = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string" ? data.error : "The request was rejected.";
      throw createError({ statusCode: status, message, data: { error: message } });
    }
    const message = "Notifications are temporarily unavailable.";
    throw createError({ statusCode: 502, message, data: { error: message } });
  }
}
