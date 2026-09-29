<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28; Claude Code (Opus 5.5), 2026-09-29.
Scope: Supplier directory, filtering, and request states; Tailwind styling after the supplier mockup. Author review: Done. -->
<script setup lang="ts">
import type { SupplierFilters } from "#shared/services/supplier-service/types";
import { useSuppliers } from "../composables/useSuppliers";
import SupplierCard from "./SupplierCard.vue";

const filters = ref<SupplierFilters>({});
const name = ref("");
const selectedType = ref("");
const { data: suppliers, pending, error, refresh } = await useSuppliers(filters);
const availableTypes = useState<string[]>("supplier-service-type-options", () => []);
watch(suppliers, (rows) => {
  availableTypes.value = [...new Set([...availableTypes.value, ...rows.map(row => row.type)])].sort();
}, { immediate: true });
const hasFilters = computed(() => Boolean(filters.value.name || filters.value.type));
const openCount = computed(() => suppliers.value.filter(supplier => supplier.isOpen).length);

function search() {
  filters.value = {
    ...(name.value.trim() ? { name: name.value.trim() } : {}),
    ...(selectedType.value ? { type: selectedType.value } : {}),
  };
}

function reset() {
  name.value = "";
  selectedType.value = "";
  filters.value = {};
}

const primaryButton = "inline-flex items-center justify-center gap-2 rounded-lg bg-[#064784] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#053765]";
const fieldLabel = "mb-1.5 block text-xs font-medium text-[#5b6570]";
const fieldInput = "w-full rounded-lg border border-[#cfd5da] bg-white px-3 py-2 text-sm text-[#25313c] focus:border-[#064784] focus:outline-none focus:ring-2 focus:ring-[#064784]/20";
const emptyState = "rounded-md bg-white px-5 py-12 text-center shadow-[0_2px_6px_rgba(0,0,0,0.14)]";
</script>

<template>
  <main class="min-h-screen bg-[#f7f9fc] px-4 py-8 text-[#25313c] sm:px-6 sm:py-10">
    <section id="suppliers" class="mx-auto w-full max-w-xl" aria-labelledby="directory-title">
      <h1 id="directory-title" class="text-center text-3xl font-bold text-black">Suppliers</h1>

      <form class="mt-6 grid gap-3 rounded-md bg-white p-4 shadow-[0_2px_6px_rgba(0,0,0,0.14)] sm:grid-cols-[1fr_10rem_auto] sm:items-end" role="search" @submit.prevent="search">
        <div>
          <label for="supplier-name" :class="fieldLabel">Name</label>
          <input id="supplier-name" v-model="name" type="search" placeholder="e.g. cafe" autocomplete="off" :class="fieldInput">
        </div>
        <div>
          <label for="supplier-type" :class="fieldLabel">Type</label>
          <select id="supplier-type" v-model="selectedType" :class="fieldInput">
            <option value="">All types</option>
            <option v-for="type in availableTypes" :key="type" :value="type">{{ type }}</option>
          </select>
        </div>
        <button type="submit" :class="primaryButton" :disabled="pending">{{ pending ? 'Searching…' : 'Search' }}</button>
      </form>

      <div class="mt-5 mb-3 flex min-h-6 items-center justify-between gap-4 text-sm text-[#5b6570]">
        <p v-if="!pending && !error" aria-live="polite">
          {{ hasFilters ? 'Found ' : '' }}{{ suppliers.length }} {{ suppliers.length === 1 ? 'supplier' : 'suppliers' }} · {{ openCount }} open now
        </p>
        <button v-if="hasFilters" class="font-medium text-[#064784] hover:underline" type="button" @click="reset">Clear filters</button>
      </div>

      <div v-if="pending" class="flex flex-col gap-3" role="status" aria-label="Loading suppliers">
        <div v-for="item in 5" :key="item" class="flex items-start gap-4 rounded-md bg-white p-3.5 shadow-[0_2px_6px_rgba(0,0,0,0.14)]" aria-hidden="true">
          <div class="flex-1">
            <div class="h-4 w-1/2 rounded bg-[#e6ecf2]"/>
            <div class="mt-2.5 h-3.5 w-1/3 rounded-full bg-[#e6ecf2]"/>
            <div class="mt-2.5 h-3.5 w-2/3 rounded bg-[#e6ecf2]"/>
          </div>
          <div class="size-16 rounded-md bg-[#e6ecf2]"/>
        </div>
      </div>
      <div v-else-if="error" :class="emptyState" role="alert">
        <h2 class="text-lg font-semibold">We couldn’t load the suppliers.</h2>
        <p class="mt-1 mb-5 text-sm text-[#5b6570]">Please try again in a moment.</p>
        <button :class="primaryButton" type="button" @click="refresh()">Try again</button>
      </div>
      <div v-else-if="!suppliers.length" :class="emptyState" role="status">
        <h2 class="text-lg font-semibold">{{ hasFilters ? 'No suppliers found.' : 'No suppliers to show yet.' }}</h2>
        <p class="mt-1 text-sm text-[#5b6570]" :class="{ 'mb-5': hasFilters }">{{ hasFilters ? 'Try a different name or explore all supplier types.' : 'Check back soon for places around campus.' }}</p>
        <button v-if="hasFilters" :class="primaryButton" type="button" @click="reset">Explore all suppliers</button>
      </div>
      <div v-else class="flex flex-col gap-3">
        <SupplierCard v-for="supplier in suppliers" :key="supplier.id" :supplier="supplier" />
      </div>
    </section>
  </main>
</template>
