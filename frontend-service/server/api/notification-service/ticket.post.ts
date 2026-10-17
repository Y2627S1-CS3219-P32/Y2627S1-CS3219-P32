// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
// Scope: Exchanges the httpOnly session cookie for a short-lived notification-service
// WebSocket ticket, so the browser never sees the JWT. Author review: Pending.
export default defineEventHandler(async (event) => {
  const token = getCookie(event, "user_access_token");
  if (!token) throw createError({ statusCode: 401, message: "A login is required." });
  try {
    return await $fetch<{ ticket: string; expiresIn: number }>("/tickets", {
      baseURL: useRuntimeConfig(event).notificationServiceBaseUrl,
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      timeout: 5000,
      retry: 0,
    });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined;
    if (status === 401) throw createError({ statusCode: 401, message: "A login is required." });
    throw createError({ statusCode: 502, message: "Notifications are temporarily unavailable." });
  }
});
