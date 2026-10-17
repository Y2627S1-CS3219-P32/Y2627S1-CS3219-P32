// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
// Scope: Nuxt endpoint listing the caller's own orders. Author review: Pending.
import { listOrders, orderListQuery } from "../../../services/order-service/client";

export default defineEventHandler((event) => listOrders(event, orderListQuery(event), true));
