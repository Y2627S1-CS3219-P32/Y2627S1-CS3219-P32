/**
    AI Assistance Disclosure:
    Tool: Copilot SDK in VS Code, 2026-10-15
    Scope: Forward authenticated projected user-event version checks.
    Author review: Pending
**/
export default defineEventHandler(async (event) => {
  const token = getCookie(event, "user_access_token");
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: "A login is required." });
  }

  const config = useRuntimeConfig(event);
  return $fetch<{ version: number }>("/users/events/version", {
    baseURL: config.userServiceBaseUrl,
    headers: { authorization: `Bearer ${token}` },
    timeout: 5000,
    retry: 0,
  });
});
