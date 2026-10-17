// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
// Scope: Nuxt endpoint for the signed-in user's notifications. Author review: Pending.
import type { NotificationPage } from "#shared/services/notification-service/types";
import { callNotificationService } from "../../services/notification-service/client";

export default defineEventHandler((event) => {
  const query = getQuery(event);
  return callNotificationService<NotificationPage>(event, "/notifications", {
    query: {
      ...(typeof query.cursor === "string" && query.cursor ? { cursor: query.cursor } : {}),
      ...(typeof query.limit === "string" && query.limit ? { limit: query.limit } : {}),
    },
  });
});
