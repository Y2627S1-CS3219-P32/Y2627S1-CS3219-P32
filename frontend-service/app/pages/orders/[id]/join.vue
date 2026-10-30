<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
Scope: Shareable join page for group orders: shows the order and a Join button, then opens
the order. Author review: Pending. -->
<script setup lang="ts">
import type { Order } from "#shared/services/order-service/types";
import OrderCard from "~/services/order-service/components/OrderCard.vue";
import { statusOf, useOrderActions, useViewerId } from "~/services/order-service/composables/useOrders";
import { isMember } from "~/services/order-service/order-view";

definePageMeta({ middleware: "auth" });

const route = useRoute();
const id = String(route.params.id);
const viewerId = useViewerId();
const { data: order, error: loadError } = await useFetch<Order>(`/api/order-service/orders/${encodeURIComponent(id)}`);
const { busy, error, run } = useOrderActions();

// People already in the group go straight to the order.
if (order.value && isMember(order.value, viewerId.value)) await navigateTo(`/orders/${id}`, { replace: true });

async function join() {
  const joined = await run(
    () => $fetch<Order>(`/api/order-service/orders/${encodeURIComponent(id)}/join`, { method: "POST" }),
    "You could not join this group order. Please try again.",
  );
  if (joined) await navigateTo(`/orders/${id}`);
}
</script>

<template>
  <main class="min-h-screen bg-[#f7f9fc]">
    <div class="mx-auto max-w-md px-4 pt-6 pb-24 md:pt-10">
      <h1 class="mb-4 text-center text-4xl font-semibold tracking-tight text-[#111]">Join Group Order</h1>
      <p v-if="loadError" class="text-center text-[#5b6570]">
        {{ statusOf(loadError) === 404 ? "This group order does not exist." : getApiErrorMessage(loadError) ?? "The order could not be loaded." }}
      </p>
      <template v-else-if="order">
        <p v-if="!order.isGroupOrder" class="text-center text-[#5b6570]">This is not a group order.</p>
        <template v-else>
          <OrderCard :order="order" :viewer-id="viewerId" detailed hide-description />
          <p v-if="order.state !== 'SYNCHRONISING'" class="mt-4 text-center text-[#5b6570]">
            This group order has already been placed.
            <NuxtLink :to="`/orders/${id}`" class="font-medium text-[#173a73] underline">View the order</NuxtLink>
          </p>
          <template v-else>
            <p v-if="error" role="alert" class="mt-4 rounded-md bg-[#fdf2f2] px-3 py-2 text-sm text-[#c62828]">{{ error }}</p>
            <button
              type="button"
              :disabled="busy"
              class="mt-4 w-full rounded-md bg-[#7a5cc2] px-4 py-3 text-sm font-medium text-white hover:bg-[#6a4cb2]"
              @click="join"
            >
              Join and add to the order
            </button>
          </template>
        </template>
      </template>
    </div>
  </main>
</template>
