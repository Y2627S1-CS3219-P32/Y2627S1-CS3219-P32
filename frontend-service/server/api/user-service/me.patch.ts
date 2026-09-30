// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-30.
// Scope: Authenticated profile-update proxy. Author review: Done.
import { toUserServiceError } from "../../services/user-service/errors";

export default defineEventHandler(async (event) => {
  const token = getCookie(event, "user_access_token");
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: "A bearer token is required." });
  }

  const config = useRuntimeConfig(event);
  try {
    return await $fetch("/me", {
      baseURL: config.userServiceBaseUrl,
      method: "PATCH",
      headers: { authorization: `Bearer ${token}` },
      body: await readBody(event),
      timeout: 5000,
      retry: 0,
    });
  } catch (error) {
    throw toUserServiceError(error);
  }
});
