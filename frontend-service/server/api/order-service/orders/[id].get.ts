// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
// Scope: Nuxt endpoint for one order. Author review: Pending.
import { getOrder } from "../../../services/order-service/client";

export default defineEventHandler((event) => getOrder(event, getRouterParam(event, "id") ?? ""));
