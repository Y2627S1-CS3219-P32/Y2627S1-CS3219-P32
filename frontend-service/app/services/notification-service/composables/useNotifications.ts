// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
// Scope: One shared WebSocket to notification-service per browser tab: fetches a ticket,
// reconnects with backoff (including when the session expires), and passes order events
// to the pages listening. Author review: Pending.
import type { OrderState } from "#shared/services/order-service/types";

export interface OrderNotification {
  eventId: string;
  type: string;
  orderId: string;
  sequence: number;
  state: OrderState;
}

interface Listener {
  onEvent: (event: OrderNotification) => void;
  // Called after every (re)connect, since events may have been missed while offline.
  onConnect?: () => void;
}

const listeners = new Set<Listener>();
let socket: WebSocket | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 1000;
let connecting = false;

function scheduleReconnect() {
  if (listeners.size === 0 || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    connect();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 30_000);
}

async function connect() {
  if (socket || connecting || listeners.size === 0) return;
  connecting = true;
  try {
    const { ticket } = await $fetch<{ ticket: string }>("/api/notification-service/ticket", { method: "POST" });
    const base = useRuntimeConfig().public.notificationServiceUrl;
    const ws = new WebSocket(`${base}/ws?ticket=${encodeURIComponent(ticket)}`);
    socket = ws;
    ws.onmessage = (message) => {
      const data = JSON.parse(String(message.data)) as { type: string; event?: OrderNotification };
      if (data.type === "ready") {
        retryDelay = 1000;
        for (const listener of listeners) listener.onConnect?.();
      } else if (data.type === "order.event" && data.event) {
        for (const listener of listeners) listener.onEvent(data.event);
      }
    };
    ws.onclose = () => {
      if (socket === ws) socket = undefined;
      scheduleReconnect();
    };
  } catch (error) {
    // Signed out: stop trying until a page subscribes again.
    if (typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 401) return;
    scheduleReconnect();
  } finally {
    connecting = false;
  }
}

// Subscribes the calling component for as long as it is mounted.
export function useOrderNotifications(listener: Listener) {
  onMounted(() => {
    listeners.add(listener);
    connect();
  });
  onBeforeUnmount(() => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
      socket?.close(1000);
      socket = undefined;
    }
  });
}
