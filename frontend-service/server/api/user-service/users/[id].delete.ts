// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-30.
// Scope: Proxy authenticated administrator user deletion. Author review: Done.
import { toUserServiceError } from "../../../services/user-service/errors";

export default defineEventHandler(async (event) => {
  const token = getCookie(event, "user_access_token");
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: "A login is required." });
  }
  const id = getRouterParam(event, "id") ?? "";
  const config = useRuntimeConfig(event);

  try {
    await $fetch(`/users/${encodeURIComponent(id)}`, {
      baseURL: config.userServiceBaseUrl,
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
      timeout: 5000,
      retry: 0,
    });
  } catch (error) {
    throw toUserServiceError(error);
  }
  setResponseStatus(event, 204);
  return null;
});
