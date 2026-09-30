// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-09-30.
// Scope: Nuxt endpoint forwarding the building list. Author review: Done.
import { fetchBuildings, requireSupplierToken, toSupplierServiceError } from "../../services/supplier-service/client";

export default defineEventHandler(async (event) => {
  const token = requireSupplierToken(event);
  const config = useRuntimeConfig(event);
  try {
    return await fetchBuildings(config.supplierServiceBaseUrl, token);
  } catch (error) {
    throw toSupplierServiceError(error);
  }
});
