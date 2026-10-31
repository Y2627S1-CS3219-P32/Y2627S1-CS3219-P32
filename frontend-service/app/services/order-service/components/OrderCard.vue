<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
Scope: Order card after the student's mockups, with the viewer's action and status. Author review: Pending.
Claude Code (Opus 5.5), 2026-10-31: optional reasons from order-ranking-service. Author review: Pending. -->
<script setup lang="ts">
import type { Order, OrderAction } from "#shared/services/order-service/types";
import { availableAction, canEdit, formatDateTime, personName, stateAccent, stateLabel, statusText } from "../order-view";

const props = defineProps<{
  order: Order;
  viewerId: number | undefined;
  // The details page shows every action and links to editing; the list only offers Accept.
  detailed?: boolean;
  busy?: boolean;
  // Why order-ranking-service suggested this order (For You tab only).
  reasons?: string[];
}>();
const emit = defineEmits<{ action: [action: OrderAction] }>();

const action = computed(() => {
  const choice = availableAction(props.order, props.viewerId);
  return props.detailed || choice?.action === "accept" ? choice : null;
});
// An OPEN order with an action shows only its button, as in the mockups.
const showStatus = computed(() => !(props.order.state === "OPEN" && action.value));
const supplierName = computed(() => props.order.supplier.name || "Unknown supplier");
</script>

<template>
  <article class="relative flex flex-col overflow-hidden rounded-sm bg-white shadow-[0_2px_8px_rgba(0,0,0,0.14)]">
    <header class="flex items-start gap-2 pr-4">
      <span class="shrink-0 px-1.5 py-0.5 text-sm font-semibold text-white" :class="stateAccent(order.state)">{{ stateLabel(order.state) }}</span>
      <h2 class="min-w-0 pt-px text-lg leading-snug font-semibold text-[#111] wrap-anywhere">
        <NuxtLink v-if="!detailed" :to="`/orders/${order.id}`" class="after:absolute after:inset-0 hover:underline">{{ order.title }}</NuxtLink>
        <template v-else>{{ order.title }}</template>
      </h2>
    </header>

    <div class="flex flex-1 flex-col gap-1.5 px-4 pt-4 pb-5 text-[15px] text-[#5b6570]">
      <p class="flex items-center gap-1.5">
        <svg class="size-4 shrink-0 text-[#6b7178]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.24-8 5v3h16v-3c0-2.76-3.58-5-8-5Z"/></svg>
        <span class="sr-only">Requested by</span>{{ personName(order.requester) }}
      </p>
      <p class="flex items-center gap-1.5">
        <svg class="size-4 shrink-0 text-[#6b7178]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a6 6 0 0 0-1 11.92V22h2v-8.08A6 6 0 0 0 12 2Z"/></svg>
        <span class="wrap-anywhere"><span class="sr-only">From</span>{{ supplierName }}</span>
        <span class="shrink-0" aria-hidden="true">⟶</span>
        <span class="wrap-anywhere"><span class="sr-only">to</span>{{ order.deliveryLocation }}</span>
      </p>
      <p class="wrap-anywhere whitespace-pre-line">{{ order.description }}</p>
      <div v-if="reasons?.length" class="mt-3 rounded-md bg-[#fdf3ea] px-3 py-2 text-sm text-[#7a4a1d]">
        <p class="font-semibold">Why this order</p>
        <ul class="mt-1 list-disc space-y-0.5 pl-4">
          <li v-for="reason in reasons" :key="reason">{{ reason }}</li>
        </ul>
      </div>
      <div class="mt-auto pt-4">
        <p>Reward: <strong class="font-semibold text-[#4a4f55]">{{ order.creditReward }}</strong></p>
        <p v-if="order.state === 'OPEN' && order.expiresAt">Expires In: <strong class="font-semibold text-[#4a4f55]">{{ formatDateTime(order.expiresAt) }}</strong></p>
      </div>
    </div>

    <footer class="relative z-10">
      <p v-if="showStatus" class="bg-[#c4c7cc] px-4 py-3 text-center text-sm font-medium text-white">{{ statusText(order, viewerId) }}</p>
      <NuxtLink
        v-if="detailed && canEdit(order, viewerId)"
        :to="`/orders/${order.id}/edit`"
        class="block border-t border-[#e1e6eb] bg-white px-4 py-3 text-center text-sm font-medium text-[#173a73] hover:bg-[#f7f9fc]"
      >
        Edit Order
      </NuxtLink>
      <button
        v-if="action"
        type="button"
        :disabled="busy"
        class="relative w-full px-10 py-3 text-sm font-medium text-white transition-colors"
        :class="action.tone === 'danger' ? 'bg-[#d9534f] hover:bg-[#c64541]' : 'bg-[#173a73] hover:bg-[#10305f]'"
        @click="emit('action', action.action)"
      >
        {{ action.label }}
        <span v-if="action.tone === 'primary'" class="absolute top-1/2 right-5 -translate-y-1/2" aria-hidden="true">→</span>
      </button>
    </footer>
  </article>
</template>
