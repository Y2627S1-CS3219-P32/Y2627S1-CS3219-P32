<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
Scope: Order details page after the student's mockups: the order card with the viewer's
action, and the order's history. Refreshes while the credit saga is still running.
Author review: Pending.
Claude Code (Opus 5.5), 2026-10-17. Scope: Live updates from notification-service instead of
polling. Author review: Pending. -->
<script setup lang="ts">
import type { Order, OrderAction, OrderEvent } from "#shared/services/order-service/types";
import OrderCard from "~/services/order-service/components/OrderCard.vue";
import OrderHistory from "~/services/order-service/components/OrderHistory.vue";
import { useOrderNotifications } from "~/services/notification-service/composables/useNotifications";
import { statusOf, useOrderActions, useViewerId } from "~/services/order-service/composables/useOrders";

definePageMeta({ middleware: "auth" });

const route = useRoute();
const id = String(route.params.id);
const path = `/api/order-service/orders/${encodeURIComponent(id)}`;
const viewerId = useViewerId();
const { data: order, error, refresh: refreshOrder } = await useFetch<Order>(path);
const { data: events, refresh: refreshEvents } = await useFetch<OrderEvent[]>(`${path}/events`, { default: () => [] });
const refresh = () => Promise.all([refreshOrder(), refreshEvents()]);
const { busy, error: actionError, perform } = useOrderActions();

async function onAction(action: OrderAction) {
  if (action === "cancel" && !window.confirm("Cancel this order?")) return;
  await perform(id, action);
  await refresh();
}

// Live updates: re-fetch when this order changes, and after (re)connecting in case
// something changed while offline.
useOrderNotifications({
  onEvent: (event) => {
    if (event.orderId === id) refresh();
  },
  onConnect: () => refresh(),
});

watch(error, (value) => {
  if (statusOf(value) === 401) navigateTo({ path: "/login", query: { redirect: route.fullPath } });
}, { immediate: true });
</script>

<template>
  <main class="min-h-screen bg-[#f7f9fc]">
    <div class="mx-auto max-w-6xl px-4 pt-6 pb-24 md:px-8 md:pt-10">
      <h1 class="mb-4 text-center text-4xl font-semibold tracking-tight text-[#111] md:text-5xl">Order Details</h1>

      <p v-if="error && statusOf(error) !== 401" class="text-center text-[#5b6570]">
        {{ statusOf(error) === 404 ? "This order does not exist." : getApiErrorMessage(error) ?? "The order could not be loaded." }}
        <NuxtLink to="/orders" class="font-medium text-[#173a73] underline">Back to orders</NuxtLink>
      </p>

      <div v-else-if="order" class="grid gap-10 md:grid-cols-[20rem_1fr] md:gap-16">
        <div>
          <OrderCard :order="order" :viewer-id="viewerId" detailed :busy="busy" @action="onAction" />
          <p v-if="actionError" role="alert" class="mt-3 rounded-md bg-[#fdf2f2] px-3 py-2 text-sm text-[#c62828]">{{ actionError }}</p>
        </div>
        <section aria-labelledby="history-heading" class="md:max-w-2xl">
          <h2 id="history-heading" class="mb-3 text-center text-3xl font-semibold text-[#111] md:sr-only">History</h2>
          <OrderHistory :events="events" />
        </section>
      </div>
    </div>
  </main>
</template>
