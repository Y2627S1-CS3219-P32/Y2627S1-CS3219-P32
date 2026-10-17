// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-15.
// Scope: Nuxt endpoint forwarding an administrator's new supplier type. Author review: Pending.
import { createSupplierReference, requireSupplierToken, toSupplierServiceError } from "../../services/supplier-service/client";

export default defineEventHandler(async (event) => {
  const token = requireSupplierToken(event);
  // supplier-service validates the name.
  const body = await readBody<{ name?: unknown }>(event);
  const config = useRuntimeConfig(event);
  try {
    const created = await createSupplierReference(config.supplierServiceBaseUrl, token, "types", String(body?.name ?? ""));
    setResponseStatus(event, 201);
    return created;
  } catch (error) {
    throw toSupplierServiceError(error);
  }
});
