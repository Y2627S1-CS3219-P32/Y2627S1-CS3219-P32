// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-29.
// Scope: Nuxt endpoint forwarding on the Compose network.
// Author review: Done.
import { fetchUsers } from "../../services/user-service/client";

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  try {
    return await fetchUsers(config.userServiceBaseUrl);
  } catch {
    throw createError({ statusCode: 502, statusMessage: "Users are temporarily unavailable. Please try again." });
  }
});
