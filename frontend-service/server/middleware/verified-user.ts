// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-11-04.
// Scope: Block pending accounts from using authenticated frontend API proxies. Author review: Pending.
const publicApiPaths = new Set([
  "/api/user-service/bootstrap",
  "/api/user-service/login",
  "/api/user-service/logout",
  "/api/user-service/me",
  "/api/user-service/register",
  "/api/user-service/verify",
]);

function getStatusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("statusCode" in error && typeof error.statusCode === "number") return error.statusCode;
  if ("status" in error && typeof error.status === "number") return error.status;
  if (
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "status" in error.response &&
    typeof error.response.status === "number"
  ) {
    return error.response.status;
  }
  return undefined;
}

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname;
  if (!path.startsWith("/api/") || publicApiPaths.has(path)) return;

  const token = getCookie(event, "user_access_token");
  if (!token) return;

  try {
    await $fetch("/me", {
      baseURL: useRuntimeConfig(event).userServiceBaseUrl,
      headers: { authorization: `Bearer ${token}` },
      timeout: 5000,
      retry: 0,
    });
  } catch (error) {
    const statusCode = getStatusCode(error);
    if (statusCode !== 401 && statusCode !== 403) throw error;

    deleteCookie(event, "user_access_token", { path: "/" });
    throw createError({
      statusCode,
      statusMessage: statusCode === 403
        ? "Account verification is required."
        : "A valid login is required.",
    });
  }
});
