// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
// Scope: Nuxt endpoint marking notifications as read; notification-service validates the body.
// Author review: Pending.
import { callNotificationService } from "../../../services/notification-service/client";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids?: string[] }>(event);
  return callNotificationService<{ updated: number }>(event, "/notifications/read", { method: "POST", body: body ?? {} });
});
