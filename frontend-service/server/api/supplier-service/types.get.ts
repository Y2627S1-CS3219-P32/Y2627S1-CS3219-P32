// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-09-30.
// Scope: Nuxt endpoint forwarding the supplier type list. Author review: Pending.
import { fetchSupplierTypes, requireSupplierToken, toSupplierServiceError } from "../../services/supplier-service/client";

export default defineEventHandler(async (event) => {
  const token = requireSupplierToken(event);
  const config = useRuntimeConfig(event);
  try {
    return await fetchSupplierTypes(config.supplierServiceBaseUrl, token);
  } catch (error) {
    throw toSupplierServiceError(error);
  }
});
