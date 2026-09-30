// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-30.
// Scope: Proxy authenticated administrator user-role updates. Author review: Done.
import { toUserServiceError } from "../../../services/user-service/errors";

export default defineEventHandler(async (event) => {
  const token = getCookie(event, "user_access_token");
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: "A login is required." });
  }
  const id = getRouterParam(event, "id") ?? "";
  const body = await readBody(event);
  const config = useRuntimeConfig(event);

  try {
    return await $fetch(`/users/${encodeURIComponent(id)}`, {
      baseURL: config.userServiceBaseUrl,
      method: "PUT",
      headers: { authorization: `Bearer ${token}` },
      body,
      timeout: 5000,
      retry: 0,
    });
  } catch (error) {
    throw toUserServiceError(error);
  }
});
