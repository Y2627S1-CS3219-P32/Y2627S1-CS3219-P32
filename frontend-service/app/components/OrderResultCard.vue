<script setup lang="ts">
import type { Json } from '#shared/services/agent-service/types';
const props = defineProps<{ orderId: string; data: Json }>();
const order = computed(() => {
  const data = props.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return {
    title: typeof data.title === 'string' ? data.title : 'Order',
    destination: typeof data.deliveryLocation === 'string' ? data.deliveryLocation : '',
    reward: typeof data.creditReward === 'number' ? data.creditReward : null,
    state: typeof data.state === 'string' ? data.state.replaceAll('_', ' ').toLowerCase() : '',
  };
});
</script>
<template>
  <section class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
    <div class="flex items-center justify-between gap-3">
      <h3 class="text-sm font-semibold">{{ order?.title ?? 'Order' }}</h3>
      <span v-if="order?.state" class="rounded-full bg-slate-100 px-2 py-1 text-xs capitalize">{{
        order.state
      }}</span>
    </div>
    <p v-if="order?.destination" class="text-sm text-slate-600">
      {{ order.destination }}
    </p>
    <p v-if="order?.reward !== null && order?.reward !== undefined" class="text-sm text-slate-600">
      {{ order.reward }} credits
    </p>
    <NuxtLink
      :to="`/orders/${orderId}`"
      class="inline-flex rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
      >View order</NuxtLink
    >
  </section>
</template>
