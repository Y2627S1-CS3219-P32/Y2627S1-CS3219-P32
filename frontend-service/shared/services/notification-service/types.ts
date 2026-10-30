// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
// Scope: Types for the notification-service API. Author review: Pending.
interface NotificationBase {
  id: string;
  type: string;
  orderId: string | null;
  createdAt: string;
  read: boolean;
}

export type AppNotification = NotificationBase & (
  | { source: "order"; payload: { title: string; creditReward: number } }
  | { source: "credit"; payload: { amount: number } }
);

export interface NotificationPage {
  items: AppNotification[];
  nextCursor: string | null;
}
