// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
// Scope: Nuxt endpoint forwarding supplier filters on the Compose network.
// Author review: Done.
import { fetchSuppliers } from "../../services/supplier-service/client";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const config = useRuntimeConfig(event);
  try {
    return await fetchSuppliers(config.supplierServiceBaseUrl, {
      ...(typeof query.name === "string" && query.name.trim() ? { name: query.name.trim() } : {}),
      ...(typeof query.type === "string" && query.type.trim() ? { type: query.type.trim() } : {}),
    });
  } catch {
    throw createError({ statusCode: 502, statusMessage: "Suppliers are temporarily unavailable. Please try again." });
  }
});
