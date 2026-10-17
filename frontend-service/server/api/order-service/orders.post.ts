// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
// Scope: Nuxt endpoint creating an order; order-service validates the body. Author review: Pending.
import type { OrderCreate } from "#shared/services/order-service/types";
import { createOrder } from "../../services/order-service/client";

export default defineEventHandler(async (event) => {
  const created = await createOrder(event, await readBody<OrderCreate>(event));
  setResponseStatus(event, 201);
  return created;
});
