// AI Assistance Disclosure: Codex (GPT-6), 2026-10-18.
// Scope: Credit balance boundary validation and dependency errors. Author review: Pending.
import type { CreditBalance } from "#shared/services/credit-service/types";

function parseBalance(value: unknown): CreditBalance {
  if (typeof value !== "object" || value === null ||
    !("totalCredits" in value) || !("reservedCredits" in value) || !("availableCredits" in value)) {
    throw new Error("Invalid credit balance.");
  }
  const { totalCredits, reservedCredits, availableCredits } = value;
  if (typeof totalCredits !== "number" || typeof reservedCredits !== "number" || typeof availableCredits !== "number" ||
    ![totalCredits, reservedCredits, availableCredits].every((amount) => Number.isSafeInteger(amount) && amount >= 0) ||
    availableCredits !== totalCredits - reservedCredits) {
    throw new Error("Invalid credit balance.");
  }
  return { totalCredits, reservedCredits, availableCredits };
}

export async function fetchCreditBalance(baseURL: string, token: string): Promise<CreditBalance> {
  try {
    return parseBalance(await $fetch<unknown>("/api/v1/credits/me", {
      baseURL,
      headers: { authorization: `Bearer ${token}` },
      timeout: 5000,
      retry: 0,
    }));
  } catch (error) {
    if (typeof error === "object" && error !== null && "statusCode" in error && "data" in error) {
      const data: unknown = error.data;
      const code = typeof data === "object" && data !== null && "code" in data ? data.code : undefined;
      if (error.statusCode === 503 && code === "ACCOUNT_PENDING") {
        throw createError({ statusCode: 503, message: "Your credit account is being set up.", data: { code } });
      }
      if (error.statusCode === 401 && (code === "UNAUTHORIZED" || code === "USER_INACTIVE")) {
        throw createError({ statusCode: 401, message: "A current login is required to view credits.", data: { code } });
      }
    }
    throw createError({ statusCode: 502, message: "Credits are temporarily unavailable." });
  }
}
