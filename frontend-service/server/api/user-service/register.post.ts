// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-29.
// Scope: Nuxt proxy for public student account registration. Author review: Done.
import { toUserServiceError } from "../../services/user-service/errors";

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  const body = await readBody<{
    name?: unknown;
    email?: unknown;
    confirmEmail?: unknown;
    password?: unknown;
  }>(event);
  let response: { token: string; user: unknown };
  try {
    response = await $fetch<{ token: string; user: unknown }>("/register", {
      baseURL: config.userServiceBaseUrl,
      method: "POST",
      body,
      timeout: 5000,
      retry: 0,
    });
  } catch (error) {
    throw toUserServiceError(error);
  }

  setCookie(event, "user_access_token", response.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  return { user: response.user };
});
