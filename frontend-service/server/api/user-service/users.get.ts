// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-29.
// Scope: Nuxt endpoint forwarding on the Compose network.
// Author review: Done.
import { fetchUsers } from "../../services/user-service/client";

export default defineEventHandler(async (event) => {
  const token = getCookie(event, "user_access_token");
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: "A login is required." });
  }

  const config = useRuntimeConfig(event);
  return fetchUsers(config.userServiceBaseUrl, token);
});
