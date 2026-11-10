export const CHAT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function chatExpiresAt(endedAt: Date): Date {
  return new Date(endedAt.getTime() + CHAT_RETENTION_MS);
}
