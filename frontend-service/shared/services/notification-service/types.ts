// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
// Scope: Types for the notification-service API. Author review: Pending.
// Claude Code (Opus 5.5), 2026-10-17: group order fields. Author review: Pending.
export interface AppNotification {
  id: string;
  source: "order" | "credit";
  type: string;
  orderId: string | null;
  payload: { title: string; creditReward: number; group?: boolean; memberName?: string | null };
  createdAt: string;
  read: boolean;
}

export interface NotificationPage {
  items: AppNotification[];
  nextCursor: string | null;
}
