// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
// Scope: Supplier filters and same-origin Nuxt data fetching. Author review: Done.
import type { Supplier, SupplierFilters } from "#shared/services/supplier-service/types";

export function useSuppliers(filters: Ref<SupplierFilters>) {
  return useFetch<Supplier[]>("/api/supplier-service/suppliers", {
    query: filters,
    default: () => [],
  });
}
