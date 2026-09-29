// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-09-30.
// Scope: Nuxt endpoint forwarding an administrator's new supplier. Author review: Pending.
import type { SupplierCreate } from "#shared/services/supplier-service/types";
import { createSupplier, requireSupplierToken, toSupplierServiceError } from "../../services/supplier-service/client";

export default defineEventHandler(async (event) => {
  const token = requireSupplierToken(event);
  // supplier-service validates the body.
  const body = await readBody<SupplierCreate>(event);
  const config = useRuntimeConfig(event);
  try {
    const created = await createSupplier(config.supplierServiceBaseUrl, token, body);
    setResponseStatus(event, 201);
    return created;
  } catch (error) {
    throw toSupplierServiceError(error);
  }
});
