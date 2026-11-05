// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-11-04.
// Scope: Forward public account verification commands to user-service. Author review: Pending.
import { toUserServiceError } from "../../services/user-service/errors";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: unknown; verificationCode?: unknown }>(event);
  const config = useRuntimeConfig(event);

  try {
    return await $fetch("/verify", {
      baseURL: config.userServiceBaseUrl,
      method: "POST",
      body,
      timeout: 5000,
      retry: 0,
    });
  } catch (error) {
    throw toUserServiceError(error);
  }
});
