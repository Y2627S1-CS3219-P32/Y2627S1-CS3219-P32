// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-29.
// Scope: Nuxt proxy for user-service login. Author review: Pending.
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  const body = await readBody<{ email?: unknown; password?: unknown }>(event);
  return $fetch("/login", {
    baseURL: config.userServiceBaseUrl,
    method: "POST",
    body,
    timeout: 5000,
    retry: 0,
  });
});
