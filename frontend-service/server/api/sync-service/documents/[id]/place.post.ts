// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
// Scope: Nuxt endpoint for placing a group order through the sync service. Author review: Pending.
const FORWARDED_STATUSES = new Set([400, 401, 403, 404, 409, 502]);

export default defineEventHandler(async (event) => {
  const token = getCookie(event, "user_access_token");
  if (!token) throw createError({ statusCode: 401, message: "A login is required." });
  const id = getRouterParam(event, "id") ?? "";
  try {
    return await $fetch<{ status: string; description: string }>(`/documents/${encodeURIComponent(id)}/place`, {
      baseURL: useRuntimeConfig(event).syncServiceBaseUrl,
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      timeout: 10000,
      retry: 0,
    });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined;
    const data = typeof error === "object" && error !== null && "data" in error ? error.data : undefined;
    const message = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
      ? data.error
      : "The order could not be placed. Please try again.";
    throw createError({ statusCode: typeof status === "number" && FORWARDED_STATUSES.has(status) ? status : 502, message, data: { error: message } });
  }
});
