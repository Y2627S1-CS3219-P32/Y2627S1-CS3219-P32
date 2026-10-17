// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-15.
// Scope: Nuxt endpoint forwarding an administrator's building rename. Author review: Pending.
import { renameSupplierReference, requireSupplierToken, toSupplierServiceError } from "../../../services/supplier-service/client";

export default defineEventHandler(async (event) => {
  const token = requireSupplierToken(event);
  const id = getRouterParam(event, "id") ?? "";
  // supplier-service validates the name.
  const body = await readBody<{ name?: unknown }>(event);
  const config = useRuntimeConfig(event);
  try {
    return await renameSupplierReference(config.supplierServiceBaseUrl, token, "buildings", id, String(body?.name ?? ""));
  } catch (error) {
    throw toSupplierServiceError(error);
  }
});
