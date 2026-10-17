// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
// Scope: Nuxt endpoint for accept, cancel, pickup, deliver and confirm. Author review: Pending.
import { ORDER_ACTIONS, type OrderAction } from "#shared/services/order-service/types";
import { performOrderAction } from "../../../../services/order-service/client";

export default defineEventHandler((event) => {
  const action = getRouterParam(event, "action") ?? "";
  if (!(ORDER_ACTIONS as readonly string[]).includes(action)) throw createError({ statusCode: 404, message: "Unknown order action." });
  return performOrderAction(event, getRouterParam(event, "id") ?? "", action as OrderAction);
});
