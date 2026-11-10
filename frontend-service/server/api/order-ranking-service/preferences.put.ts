// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
// Scope: Nuxt endpoint saving the courier's ranking preferences. Author review: Pending.
import { savePreferences } from "../../services/order-ranking-service/client";

export default defineEventHandler(async (event) => savePreferences(event, await readBody(event)));
