// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28; Claude Code (Opus 5.5), 2026-09-29.
// Scope: Server-side client for the supplier service, forwarding the user's bearer token. Author review: Done.
import type { H3Event } from "h3";
import type { Supplier, SupplierFilters, SupplierUpdate } from "#shared/services/supplier-service/types";

const FORWARDED_STATUSES = new Set([400, 401, 403, 404, 409]);

function options(baseURL: string, token: string) {
  return {
    baseURL,
    headers: { authorization: `Bearer ${token}` },
    timeout: 5000,
    retry: 0 as const,
  };
}

export function requireSupplierToken(event: H3Event): string {
  const token = getCookie(event, "user_access_token");
  if (!token) throw createError({ statusCode: 401, message: "A login is required." });
  return token;
}

// Client errors from supplier-service keep their status and message; anything else is a 502.
export function toSupplierServiceError(error: unknown) {
  if (typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" && FORWARDED_STATUSES.has(error.statusCode)) {
    const data = "data" in error ? error.data : undefined;
    const message = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
      ? data.error
      : "The supplier request was rejected.";
    return createError({ statusCode: error.statusCode, message });
  }
  return createError({ statusCode: 502, message: "Suppliers are temporarily unavailable. Please try again." });
}

export function fetchSuppliers(baseURL: string, token: string, query: SupplierFilters) {
  return $fetch<Supplier[]>("/suppliers", { ...options(baseURL, token), query });
}

export function updateSupplier(baseURL: string, token: string, id: string, body: SupplierUpdate) {
  return $fetch<Supplier>(`/suppliers/${encodeURIComponent(id)}`, { ...options(baseURL, token), method: "PUT", body });
}

export function deleteSupplier(baseURL: string, token: string, id: string) {
  return $fetch(`/suppliers/${encodeURIComponent(id)}`, { ...options(baseURL, token), method: "DELETE" });
}
