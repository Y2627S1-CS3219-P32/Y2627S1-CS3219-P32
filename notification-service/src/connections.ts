/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: This instance's map of user id to open WebSockets (a user may have several
 * tabs or devices). Author review: Pending.
 */
import { WebSocket } from "ws";

const sockets = new Map<number, Set<WebSocket>>();

export function addSocket(userId: number, socket: WebSocket): void {
  let set = sockets.get(userId);
  if (!set) sockets.set(userId, set = new Set());
  set.add(socket);
  socket.once("close", () => {
    set.delete(socket);
    if (set.size === 0 && sockets.get(userId) === set) sockets.delete(userId);
  });
}

// Returns how many sockets the message was sent to.
export function sendToUser(userId: number, message: unknown): number {
  const set = sockets.get(userId);
  if (!set) return 0;
  const data = JSON.stringify(message);
  let sent = 0;
  for (const socket of set) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(data);
      sent += 1;
    }
  }
  return sent;
}

export function allSockets(): WebSocket[] {
  return [...sockets.values()].flatMap((set) => [...set]);
}
