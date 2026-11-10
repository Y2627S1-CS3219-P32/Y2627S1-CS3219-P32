<script setup lang="ts">
import type { Mandate, Page } from '#shared/services/agent-service/types';
definePageMeta({ middleware: 'auth' });
const { data: page } = await useFetch<Page<Mandate>>('/api/mandate-service/mandates', {
  default: () => ({ items: [], next_cursor: null }),
});
const tab = ref<'current' | 'past'>('current');
const visibleMandates = computed(() => page.value.items.filter((mandate) =>
  (mandate.status === 'active' || mandate.status === 'paused') === (tab.value === 'current'),
).sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active')));
async function switchTab() {
  tab.value = tab.value === 'current' ? 'past' : 'current';
  await nextTick();
  document.getElementById(`mandates-tab-${tab.value}`)?.focus();
}
function changed(mandate: Mandate) {
  page.value = {
    ...page.value,
    items: page.value.items.map((item) => (item.id === mandate.id ? mandate : item)),
  };
}
async function more() {
  const next = await $fetch<Page<Mandate>>('/api/mandate-service/mandates', {
    query: { cursor: page.value.next_cursor },
  });
  page.value = { items: [...page.value.items, ...next.items], next_cursor: next.next_cursor };
}
</script>
<template>
  <main class="mx-auto flex max-w-7xl gap-4 p-4 md:p-6">
    <FriendRail />
    <section class="min-w-0 flex-1 space-y-5">
      <h1 class="text-2xl font-semibold">Your mandates</h1>
      <p class="text-sm text-slate-600">
        Review and manage Friend’s authorization to create orders.
      </p>
      <div class="flex gap-2" role="tablist" aria-label="Mandate status">
        <button
          v-for="item in ['current', 'past'] as const"
          :id="`mandates-tab-${item}`"
          :key="item"
          type="button"
          role="tab"
          :aria-selected="tab === item"
          aria-controls="mandates-panel"
          :tabindex="tab === item ? 0 : -1"
          class="rounded-full border px-5 py-1.5 text-sm font-medium capitalize"
          :class="tab === item ? 'border-slate-200 bg-slate-200 text-slate-950' : 'border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-900'"
          @click="tab = item"
          @keydown.left.prevent="switchTab"
          @keydown.right.prevent="switchTab"
        >
          {{ item }}
        </button>
      </div>
      <p v-if="!page.items.length" class="text-slate-600">
        No mandates yet.
        <NuxtLink to="/agent" class="text-blue-800 underline"
          >Start a conversation with Friend.</NuxtLink
        >
      </p>
      <div id="mandates-panel" role="tabpanel" :aria-labelledby="`mandates-tab-${tab}`">
        <p v-if="page.items.length && !visibleMandates.length" class="text-slate-600">
          No {{ tab }} mandates{{ page.next_cursor ? ' loaded. Load more mandates below.' : '.' }}
        </p>
        <div class="grid gap-5 lg:grid-cols-2">
          <MandateCard
            v-for="mandate in visibleMandates"
            :key="mandate.id"
            :mandate="mandate"
            @changed="changed"
          />
        </div>
      </div>
      <button v-if="page.next_cursor" class="rounded border px-4 py-2" @click="more">
        More mandates
      </button>
    </section>
  </main>
</template>
