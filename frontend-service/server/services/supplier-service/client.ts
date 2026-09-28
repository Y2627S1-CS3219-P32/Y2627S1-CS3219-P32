// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
// Scope: Server-side client for the supplier service. Author review: pending.
import type { Supplier, SupplierFilters } from "#shared/services/supplier-service/types";

export function fetchSuppliers(baseURL: string, query: SupplierFilters) {
  return $fetch<Supplier[]>("/suppliers", {
    baseURL,
    query,
    timeout: 5000,
    retry: 0,
  });
}
