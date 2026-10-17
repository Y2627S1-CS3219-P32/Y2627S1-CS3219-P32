// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
// Scope: Nuxt endpoint editing an order; order-service validates the body. Author review: Pending.
import type { OrderEdit } from "#shared/services/order-service/types";
import { editOrder } from "../../../services/order-service/client";

export default defineEventHandler(async (event) =>
  editOrder(event, getRouterParam(event, "id") ?? "", await readBody<OrderEdit>(event)));
