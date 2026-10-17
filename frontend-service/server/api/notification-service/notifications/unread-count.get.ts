// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
// Scope: Nuxt endpoint for the unread notification count. Author review: Pending.
import { callNotificationService } from "../../../services/notification-service/client";

export default defineEventHandler((event) => callNotificationService<{ count: number }>(event, "/notifications/unread-count"));
