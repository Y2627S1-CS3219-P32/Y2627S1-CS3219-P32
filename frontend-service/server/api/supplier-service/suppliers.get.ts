// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28; Claude Code (Opus 5.5), 2026-09-29.
// Scope: Nuxt endpoint forwarding supplier filters and the user's token on the Compose network.
// Author review: Pending.
import { fetchSuppliers, requireSupplierToken, toSupplierServiceError } from "../../services/supplier-service/client";

export default defineEventHandler(async (event) => {
  const token = requireSupplierToken(event);
  const query = getQuery(event);
  const config = useRuntimeConfig(event);
  try {
    return await fetchSuppliers(config.supplierServiceBaseUrl, token, {
      ...(typeof query.name === "string" && query.name.trim() ? { name: query.name.trim() } : {}),
      ...(typeof query.type === "string" && query.type.trim() ? { type: query.type.trim() } : {}),
    });
  } catch (error) {
    throw toSupplierServiceError(error);
  }
});
