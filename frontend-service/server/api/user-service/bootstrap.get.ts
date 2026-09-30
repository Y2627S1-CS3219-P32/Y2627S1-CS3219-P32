// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-30.
// Scope: Proxy for first-administrator setup availability. Author review: Done.
import { toUserServiceError } from "../../services/user-service/errors";

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  try {
    return await $fetch("/bootstrap", {
      baseURL: config.userServiceBaseUrl,
      timeout: 5000,
      retry: 0,
    });
  } catch (error) {
    throw toUserServiceError(error);
  }
});
