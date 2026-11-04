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
  let response: { user: unknown };
  try {
    response = await $fetch<{ user: unknown }>("/register", {
      baseURL: config.userServiceBaseUrl,
      method: "POST",
      body,
      timeout: 5000,
      retry: 0,
    });
  } catch (error) {
    throw toUserServiceError(error);
  }

  return { user: response.user };
});
