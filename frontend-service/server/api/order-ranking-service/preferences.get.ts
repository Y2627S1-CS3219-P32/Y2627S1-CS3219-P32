// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
// Scope: Nuxt endpoint for the courier's ranking preferences. Author review: Pending.
import { getPreferences } from "../../services/order-ranking-service/client";

export default defineEventHandler((event) => getPreferences(event));
