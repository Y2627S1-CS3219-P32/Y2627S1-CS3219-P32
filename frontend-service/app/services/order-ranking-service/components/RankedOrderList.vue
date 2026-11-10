<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
Scope: The "For You" tab: open orders ranked by order-ranking-service, each with the
reasons it was suggested, an optional browser location for distance, and the
preferences dialog. Author review: Pending.
Claude Code (Opus 5.5), 2026-11-01. Scope: Summary counts delivered orders; the list is fetched under
RANKINGS_KEY so the order board can refresh it. Author review: Pending. -->
<script setup lang="ts">
import type { OrderAction } from "#shared/services/order-service/types";
import type { RankedOrderList } from "#shared/services/order-ranking-service/types";
import OrderCard from "../../order-service/components/OrderCard.vue";
import { RANKINGS_KEY } from "../rankings";
import RankingPreferencesDialog from "./RankingPreferencesDialog.vue";

defineProps<{ viewerId: number | undefined; busy: boolean }>();
const emit = defineEmits<{ action: [orderId: string, action: OrderAction] }>();

const LOCATION_KEY = "foc-ranking-use-location";
const location = ref<{ lat: string; lng: string } | null>(null);
const locating = ref(false);
const locationError = ref("");
const preferencesOpen = ref(false);

const query = computed(() => ({ limit: 24, ...(location.value ?? {}) }));
// The order board refreshes this list by its key after a failed action and on order notifications.
const { data, pending, error, refresh } = await useFetch<RankedOrderList>("/api/order-ranking-service/rankings", { query, key: RANKINGS_KEY });

function remember(on: boolean) {
  try {
    if (on) localStorage.setItem(LOCATION_KEY, "1");
    else localStorage.removeItem(LOCATION_KEY);
  } catch {
    // Storage can be unavailable (private windows); the choice just isn't remembered.
  }
}

function locate() {
  if (!("geolocation" in navigator)) {
    locationError.value = "Your browser can't share its location.";
    return;
  }
  locating.value = true;
  locationError.value = "";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      locating.value = false;
      location.value = { lat: position.coords.latitude.toFixed(6), lng: position.coords.longitude.toFixed(6) };
      remember(true);
    },
    () => {
      locating.value = false;
      locationError.value = "Location was not shared, so distance uses where you usually pick up.";
      remember(false);
    },
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
  );
}

function stopLocating() {
  location.value = null;
  remember(false);
}

onMounted(() => {
  try {
    if (localStorage.getItem(LOCATION_KEY)) locate();
  } catch {
    // See remember().
  }
});

const summary = computed(() => {
  const context = data.value?.context;
  if (!context) return "";
  if (!context.personalised) return "Deliver a few orders, share your location or set your preferences, and this list will learn what suits you.";
  const parts = [];
  if (context.pastOrders > 0) parts.push(`${context.pastOrders} order${context.pastOrders === 1 ? "" : "s"} you've delivered`);
  if (context.location === "current") parts.push("your location");
  else if (context.location === "usual") parts.push("where you usually pick up");
  return parts.length ? `Ranked using ${parts.join(", ")} and your preferences.` : "Ranked using your preferences.";
});

const button = "rounded-full border border-[#d3d7db] bg-white px-3 py-1.5 text-sm text-[#33383d] hover:bg-[#f7f9fc] disabled:opacity-60";
</script>

<template>
  <section aria-labelledby="for-you-heading">
    <h2 id="for-you-heading" class="sr-only">Orders suggested for you</h2>
    <div class="mt-4 flex flex-wrap items-center justify-center gap-2">
      <button v-if="!location" type="button" :class="button" :disabled="locating" @click="locate">
        {{ locating ? "Finding you…" : "Use my location" }}
      </button>
      <button v-else type="button" :class="button" @click="stopLocating">Stop using my location</button>
      <button type="button" :class="button" @click="preferencesOpen = true">My preferences</button>
    </div>
    <p v-if="locationError" class="mt-2 text-center text-sm text-[#5b6570]">{{ locationError }}</p>
    <p v-if="summary" class="mx-auto mt-3 max-w-xl text-center text-sm text-[#5b6570]">{{ summary }}</p>

    <p v-if="error" class="mt-10 text-center text-[#5b6570]">
      {{ getApiErrorMessage(error) ?? "Suggestions could not be loaded." }}
      <button type="button" class="ml-1 font-medium text-[#173a73] underline" @click="refresh()">Try again</button>
    </p>
    <p v-else-if="!pending && data?.items.length === 0" class="mt-10 text-center text-[#5b6570]">No open orders to suggest right now.</p>

    <ol class="mt-6 grid gap-6 md:mt-8 md:grid-cols-2 md:gap-10 lg:grid-cols-3" aria-live="polite">
      <li v-for="item in data?.items ?? []" :key="item.order.id" class="flex">
        <OrderCard
          class="w-full"
          :order="item.order"
          :viewer-id="viewerId"
          :busy="busy"
          :reasons="item.reasons.map(reason => reason.text)"
          @action="emit('action', item.order.id, $event)"
        />
      </li>
    </ol>

    <RankingPreferencesDialog :open="preferencesOpen" @close="preferencesOpen = false" @saved="refresh()" />
  </section>
</template>
