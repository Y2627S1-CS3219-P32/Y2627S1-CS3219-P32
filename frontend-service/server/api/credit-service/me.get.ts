// AI Assistance Disclosure: Codex (GPT-6), 2026-10-18.
// Scope: Authenticated current-user credit balance proxy. Author review: Pending.
import { fetchCreditBalance } from "../../services/credit-service/client";

export default defineEventHandler((event) => {
  const token = getCookie(event, "user_access_token");
  if (!token) throw createError({ statusCode: 401, message: "A login is required." });
  return fetchCreditBalance(useRuntimeConfig(event).creditServiceBaseUrl, token);
});
