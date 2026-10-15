// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-15.
// Scope: Nuxt endpoint forwarding an administrator's supplier type delete. Author review: Pending.
import { deleteSupplierReference, requireSupplierToken, toSupplierServiceError } from "../../../services/supplier-service/client";

export default defineEventHandler(async (event) => {
  const token = requireSupplierToken(event);
  const id = getRouterParam(event, "id") ?? "";
  const config = useRuntimeConfig(event);
  try {
    await deleteSupplierReference(config.supplierServiceBaseUrl, token, "types", id);
  } catch (error) {
    throw toSupplierServiceError(error);
  }
  setResponseStatus(event, 204);
  return null;
});
