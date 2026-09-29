// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-09-29.
// Scope: Nuxt endpoint forwarding an administrator's supplier update. Author review: Pending.
import type { SupplierUpdate } from "#shared/services/supplier-service/types";
import { requireSupplierToken, toSupplierServiceError, updateSupplier } from "../../../services/supplier-service/client";

export default defineEventHandler(async (event) => {
  const token = requireSupplierToken(event);
  const id = getRouterParam(event, "id") ?? "";
  // supplier-service validates the body.
  const body = await readBody<SupplierUpdate>(event);
  const config = useRuntimeConfig(event);
  try {
    return await updateSupplier(config.supplierServiceBaseUrl, token, id, body);
  } catch (error) {
    throw toSupplierServiceError(error);
  }
});
