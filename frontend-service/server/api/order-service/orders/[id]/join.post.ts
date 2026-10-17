// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
// Scope: Nuxt endpoint for joining a group order. Author review: Pending.
import { joinOrder } from "../../../../services/order-service/client";

export default defineEventHandler((event) => joinOrder(event, getRouterParam(event, "id") ?? ""));
