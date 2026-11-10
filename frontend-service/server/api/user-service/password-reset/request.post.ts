import { toUserServiceError } from "../../../services/user-service/errors";

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  const body = await readBody<{ email?: unknown }>(event);

  try {
    return await $fetch("/password-reset/request", {
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
