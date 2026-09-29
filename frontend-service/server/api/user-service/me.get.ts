// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-29.
// Scope: Nuxt proxy for the JWT-protected current-user endpoint. Author review: Pending.
export default defineEventHandler(async (event) => {
  const token = getCookie(event, "user_access_token");
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: "A bearer token is required." });
  }

  const config = useRuntimeConfig(event);
  return $fetch("/me", {
    baseURL: config.userServiceBaseUrl,
    headers: { authorization: `Bearer ${token}` },
    timeout: 5000,
    retry: 0,
  });
});
