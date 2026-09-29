// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-29.
// Scope: Nuxt proxy for public student account registration. Author review: Done.
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  const body = await readBody<{
    name?: unknown;
    email?: unknown;
    confirmEmail?: unknown;
    password?: unknown;
  }>(event);
  const response = await $fetch<{ token: string; user: unknown }>("/register", {
    baseURL: config.userServiceBaseUrl,
    method: "POST",
    body,
    timeout: 5000,
    retry: 0,
  });

  setCookie(event, "user_access_token", response.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  return { user: response.user };
});
