<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
Scope: Notification bell with unread badge, a panel of past notifications (cursor paged,
mark as read), and toasts for live notifications. Author review: Pending. -->
<script setup lang="ts">
import type { AppNotification, NotificationPage } from "#shared/services/notification-service/types";
import { useOrderNotifications } from "../composables/useNotifications";
import { notificationLink, notificationText } from "../notification-text";
import { formatStamp } from "~/services/order-service/order-view";

const route = useRoute();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const button = ref<HTMLButtonElement | null>(null);

const unread = ref(0);
const items = ref<AppNotification[]>([]);
const nextCursor = ref<string | null>(null);
const loaded = ref(false);
const loading = ref(false);
const failed = ref(false);

async function loadUnread() {
  try {
    unread.value = (await $fetch<{ count: number }>("/api/notification-service/notifications/unread-count")).count;
  } catch {
    // The badge simply stays as it is.
  }
}

async function loadPage(reset = false) {
  if (loading.value) return;
  loading.value = true;
  failed.value = false;
  try {
    const page = await $fetch<NotificationPage>("/api/notification-service/notifications", {
      query: { limit: 15, ...(!reset && nextCursor.value ? { cursor: nextCursor.value } : {}) },
    });
    items.value = reset ? page.items : [...items.value, ...page.items];
    nextCursor.value = page.nextCursor;
    loaded.value = true;
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

function toggle() {
  open.value = !open.value;
  if (open.value) loadPage(true);
}

function close(restoreFocus = false) {
  open.value = false;
  if (restoreFocus) button.value?.focus();
}

async function markRead(ids?: string[]) {
  const targets = ids ?? items.value.filter(item => !item.read).map(item => item.id);
  if (ids && targets.length === 0) return;
  for (const item of items.value) if (!ids || targets.includes(item.id)) item.read = true;
  try {
    await $fetch("/api/notification-service/notifications/read", { method: "POST", body: ids ? { ids: targets } : {} });
  } finally {
    await loadUnread();
  }
}

async function openNotification(notification: AppNotification) {
  close();
  dismiss(notification.id);
  if (!notification.read) markRead([notification.id]);
  const link = notificationLink(notification);
  if (link) await navigateTo(link);
}

// Toasts: newest on top, at most three, each for six seconds.
const toasts = ref<AppNotification[]>([]);
const timers = new Map<string, ReturnType<typeof setTimeout>>();
function dismiss(id: string) {
  toasts.value = toasts.value.filter(toast => toast.id !== id);
  clearTimeout(timers.get(id));
  timers.delete(id);
}

useOrderNotifications({
  onNotification: (notification) => {
    if (items.value.some(item => item.id === notification.id)) return;
    unread.value += 1;
    if (loaded.value) items.value.unshift(notification);
    toasts.value = [notification, ...toasts.value].slice(0, 3);
    timers.set(notification.id, setTimeout(() => dismiss(notification.id), 6000));
  },
  // Catch up on anything that arrived while disconnected.
  onConnect: () => {
    loadUnread();
    if (open.value) loadPage(true);
  },
});

function onDocumentClick(event: MouseEvent) {
  if (open.value && !root.value?.contains(event.target as Node)) close();
}
onMounted(() => document.addEventListener("click", onDocumentClick));
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocumentClick);
  for (const timer of timers.values()) clearTimeout(timer);
});
watch(() => route.fullPath, () => close());
</script>

<template>
  <div ref="root" class="relative" @keydown.esc="close(true)">
    <button
      ref="button"
      type="button"
      class="relative flex items-center rounded-lg px-3 py-2.5 text-[#5b6570] transition-colors hover:bg-[#f7f9fc] hover:text-[#064784]"
      :class="{ 'bg-[#eef4fa] text-[#064784]': open }"
      :aria-label="unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="toggle"
    >
      <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
      <span
        v-if="unread > 0"
        class="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#d9534f] px-1 text-[10px] font-semibold text-white"
        aria-hidden="true"
      >{{ unread > 99 ? "99+" : unread }}</span>
    </button>

    <section
      v-if="open"
      role="dialog"
      aria-label="Notifications"
      class="fixed inset-x-3 bottom-[4.5rem] z-50 flex max-h-[70vh] flex-col overflow-hidden rounded-lg border border-[#e1e6eb] bg-white shadow-xl md:absolute md:inset-x-auto md:top-full md:right-0 md:bottom-auto md:mt-2 md:w-96"
    >
      <header class="flex items-center justify-between border-b border-[#e1e6eb] px-4 py-3">
        <h2 class="font-semibold text-[#111]">Notifications</h2>
        <button type="button" class="text-sm font-medium text-[#173a73] hover:underline disabled:opacity-40" :disabled="unread === 0" @click="markRead()">
          Mark all as read
        </button>
      </header>
      <ol class="flex-1 overflow-y-auto">
        <li v-for="notification in items" :key="notification.id" class="border-b border-[#f0f2f4] last:border-b-0">
          <button
            type="button"
            class="flex w-full gap-3 px-4 py-3 text-left hover:bg-[#f7f9fc]"
            :class="{ 'bg-[#f3f7fc]': !notification.read }"
            @click="openNotification(notification)"
          >
            <span class="mt-1.5 size-2 shrink-0 rounded-full" :class="notification.read ? 'bg-transparent' : 'bg-[#3b78c4]'" aria-hidden="true" />
            <span class="min-w-0">
              <span class="block text-sm text-[#25313c]">{{ notificationText(notification) }}</span>
              <span class="mt-0.5 block text-xs text-[#8a9099]">
                {{ formatStamp(notification.createdAt) }}<span v-if="!notification.read" class="sr-only">, unread</span>
              </span>
            </span>
          </button>
        </li>
      </ol>
      <p v-if="failed" class="px-4 py-3 text-sm text-[#c62828]">Notifications could not be loaded.</p>
      <p v-else-if="loaded && items.length === 0" class="px-4 py-6 text-center text-sm text-[#5b6570]">No notifications yet.</p>
      <button
        v-if="nextCursor"
        type="button"
        :disabled="loading"
        class="border-t border-[#e1e6eb] px-4 py-2.5 text-sm font-medium text-[#173a73] hover:bg-[#f7f9fc]"
        @click="loadPage()"
      >
        Load more
      </button>
    </section>

    <Teleport to="body">
      <div class="pointer-events-none fixed inset-x-3 top-3 z-[60] flex flex-col items-stretch gap-2 md:inset-x-auto md:top-20 md:right-6 md:w-96" aria-live="polite">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="pointer-events-auto flex items-start gap-3 rounded-lg border border-[#e1e6eb] bg-white p-3 shadow-lg"
        >
          <button type="button" class="min-w-0 flex-1 text-left text-sm text-[#25313c] hover:underline" @click="openNotification(toast)">
            {{ notificationText(toast) }}
          </button>
          <button type="button" class="shrink-0 text-lg leading-none text-[#8a9099] hover:text-[#25313c]" aria-label="Dismiss" @click="dismiss(toast.id)">×</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
