// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
// Scope: Nuxt endpoint for an order's history. Author review: Pending.
import { getOrderEvents } from "../../../../services/order-service/client";

export default defineEventHandler((event) => getOrderEvents(event, getRouterParam(event, "id") ?? ""));
