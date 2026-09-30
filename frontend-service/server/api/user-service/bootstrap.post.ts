// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-30.
// Scope: Proxy for secret-protected first-administrator setup. Author review: Done.
import { toUserServiceError } from "../../services/user-service/errors";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const secret = getHeader(event, "x-bootstrap-secret");
  const config = useRuntimeConfig(event);
  try {
    return await $fetch("/bootstrap", {
      baseURL: config.userServiceBaseUrl,
      method: "POST",
      headers: secret ? { "x-bootstrap-secret": secret } : {},
      body,
      timeout: 5000,
      retry: 0,
    });
  } catch (error) {
    throw toUserServiceError(error);
  }
});
