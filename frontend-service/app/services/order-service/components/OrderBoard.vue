<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
Scope: Orders page after the student's mockups: state tabs, supplier filter and reward/time
sorting (FR11.1.2), cursor-paged "Load more", accepting from the list, and the new-order
button. Author review: Pending.
Claude Code (Opus 5.5), 2026-10-17. Scope: Mine tab. Author review: Pending.
Claude Code (Opus 5.5), 2026-10-17. Scope: Live updates from notification-service. Author review: Pending.
Claude Code (Opus 5.5), 2026-10-31. Scope: For You tab from order-ranking-service. Author review: Pending.
Claude Code (Opus 5.5), 2026-11-01. Scope: Failed actions and notifications refresh the For You list when it is shown. Author review: Pending. -->
<script setup lang="ts">
import type { Order, OrderPage, OrderSort } from "#shared/services/order-service/types";
import type { Supplier } from "#shared/services/supplier-service/types";
import { useOrderNotifications } from "~/services/notification-service/composables/useNotifications";
import { statusOf, useOrderActions, useViewerId } from "../composables/useOrders";
import { ORDER_TABS } from "../order-view";
import OrderCard from "./OrderCard.vue";
import RankedOrderList from "../../order-ranking-service/components/RankedOrderList.vue";
import { RANKINGS_KEY } from "../../order-ranking-service/rankings";

const route = useRoute();
const router = useRouter();
const viewerId = useViewerId();

const tab = computed(() => ORDER_TABS.find(item => item.key === route.query.tab) ?? ORDER_TABS[0]);
const supplierId = ref(typeof route.query.supplier === "string" ? route.query.supplier : "");
const sort = ref<OrderSort>("-createdAt");
const SORTS: { value: OrderSort; label: string }[] = [
  { value: "-createdAt", label: "Newest first" },
  { value: "createdAt", label: "Oldest first" },
  { value: "-reward", label: "Highest reward" },
  { value: "reward", label: "Lowest reward" },
];

const query = computed(() => ({
  ...(tab.value.states ? { state: tab.value.states } : {}),
  ...(supplierId.value ? { supplierId: supplierId.value } : {}),
  sort: sort.value,
  limit: 24,
}));

const endpoint = computed(() => tab.value.mine ? "/api/order-service/orders/me" : "/api/order-service/orders");
const { data: firstPage, pending, error, refresh } = await useFetch<OrderPage>(endpoint, { query });
const { data: suppliers } = await useFetch<Supplier[]>("/api/supplier-service/suppliers", { default: () => [] });

// Later pages are appended; changing a filter starts again from the first page.
const morePages = ref<Order[]>([]);
const nextCursor = ref<string | null>(null);
watch(firstPage, (page) => {
  morePages.value = [];
  nextCursor.value = page?.nextCursor ?? null;
}, { immediate: true });
const orders = computed(() => [...(firstPage.value?.items ?? []), ...morePages.value]);

const { busy, error: actionError, run, perform } = useOrderActions();

// The For You list loads its own orders, so it is the one to refresh while it is shown.
function refreshShown() {
  return tab.value.ranked ? refreshNuxtData(RANKINGS_KEY) : refresh();
}

async function loadMore() {
  if (!nextCursor.value) return;
  const page = await run(
    () => $fetch<OrderPage>(endpoint.value, { query: { ...query.value, cursor: nextCursor.value } }),
    "More orders could not be loaded.",
  );
  if (!page) return;
  morePages.value.push(...page.items);
  nextCursor.value = page.nextCursor;
}

function selectTab(key: string) {
  router.replace({ query: { ...route.query, tab: key === "all" ? undefined : key } });
}

async function onAction(orderId: string, action: Parameters<typeof perform>[1]) {
  const updated = await perform(orderId, action);
  if (updated) await navigateTo(`/orders/${orderId}`);
  else await refreshShown();
}

// Notifications cover the viewer's own orders (as requester or courier). Bursts of events
// (e.g. a saga step right after creation) cause a single refresh.
let pendingRefresh: ReturnType<typeof setTimeout> | undefined;
function refreshSoon() {
  clearTimeout(pendingRefresh);
  pendingRefresh = setTimeout(() => refreshShown(), 300);
}
useOrderNotifications({ onEvent: refreshSoon, onConnect: refreshSoon });
onBeforeUnmount(() => clearTimeout(pendingRefresh));

watch(error, (value) => {
  if (statusOf(value) === 401) navigateTo({ path: "/login", query: { redirect: route.fullPath } });
}, { immediate: true });

const select = "rounded-full border border-[#d3d7db] bg-white px-3 py-1.5 text-sm text-[#33383d]";
</script>

<template>
  <main class="min-h-screen bg-[#f7f9fc]">
    <div class="mx-auto max-w-6xl px-4 pt-6 pb-28 md:px-8 md:pt-10">
      <h1 class="text-center text-4xl font-semibold tracking-tight text-[#111] md:text-5xl">Orders</h1>

      <div class="mx-auto mt-4 flex max-w-xs flex-wrap justify-center gap-2 md:max-w-none" role="tablist" aria-label="Order status">
        <button
          v-for="item in ORDER_TABS"
          :key="item.key"
          type="button"
          role="tab"
          :aria-selected="tab.key === item.key"
          class="rounded-full border px-5 py-1.5 text-[15px] font-medium transition-colors md:min-w-28"
          :class="tab.key === item.key ? 'border-[#e6873a] bg-[#e6873a] text-white' : 'border-[#d3d7db] bg-white text-[#111] hover:bg-[#f7f9fc]'"
          @click="selectTab(item.key)"
        >
          {{ item.label }}
        </button>
      </div>

      <div v-if="!tab.ranked" class="mt-4 flex flex-wrap justify-center gap-2">
        <label class="sr-only" for="order-supplier">Supplier</label>
        <select id="order-supplier" v-model="supplierId" :class="select">
          <option value="">All suppliers</option>
          <option v-for="supplier in suppliers" :key="supplier.id" :value="supplier.id">{{ supplier.name }}</option>
        </select>
        <label class="sr-only" for="order-sort">Sort</label>
        <select id="order-sort" v-model="sort" :class="select">
          <option v-for="option in SORTS" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </div>

      <p v-if="actionError" role="alert" class="mx-auto mt-4 max-w-md rounded-md bg-[#fdf2f2] px-3 py-2 text-center text-sm text-[#c62828]">{{ actionError }}</p>

      <RankedOrderList v-if="tab.ranked" :viewer-id="viewerId" :busy="busy" @action="onAction" />

      <template v-else>
        <p v-if="error && statusOf(error) !== 401" class="mt-10 text-center text-[#5b6570]">
          {{ getApiErrorMessage(error) ?? "Orders could not be loaded." }}
          <button type="button" class="ml-1 font-medium text-[#173a73] underline" @click="refresh()">Try again</button>
        </p>
        <p v-else-if="!pending && orders.length === 0" class="mt-10 text-center text-[#5b6570]">{{ tab.mine ? "You haven't made any orders yet." : "No orders here yet." }}</p>

        <ul class="mt-6 grid gap-6 md:mt-8 md:grid-cols-2 md:gap-10 lg:grid-cols-3" aria-live="polite">
          <li v-for="order in orders" :key="order.id" class="flex">
            <OrderCard class="w-full" :order="order" :viewer-id="viewerId" :busy="busy" @action="onAction(order.id, $event)" />
          </li>
        </ul>

        <div v-if="nextCursor" class="mt-8 flex justify-center">
          <button type="button" :disabled="busy" class="rounded-full border border-[#d3d7db] bg-white px-6 py-2 text-sm font-medium text-[#173a73] hover:bg-[#f7f9fc]" @click="loadMore">
            Load more
          </button>
        </div>
      </template>

      <NuxtLink
        to="/orders/new"
        aria-label="New order"
        class="fixed right-5 bottom-20 z-40 flex size-16 items-center justify-center rounded-full bg-[#173a73] text-4xl font-light text-white shadow-lg hover:bg-[#10305f] md:right-10 md:bottom-10 md:size-20"
      >
        <span aria-hidden="true" class="-mt-1">+</span>
      </NuxtLink>
    </div>
  </main>
</template>
