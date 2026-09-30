// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-09-29.
// Scope: Nuxt endpoint forwarding an administrator's supplier delete. Author review: Done.
import { deleteSupplier, requireSupplierToken, toSupplierServiceError } from "../../../services/supplier-service/client";

export default defineEventHandler(async (event) => {
  const token = requireSupplierToken(event);
  const id = getRouterParam(event, "id") ?? "";
  const config = useRuntimeConfig(event);
  try {
    await deleteSupplier(config.supplierServiceBaseUrl, token, id);
  } catch (error) {
    throw toSupplierServiceError(error);
  }
  setResponseStatus(event, 204);
  return null;
});
