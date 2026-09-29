<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
Scope: Supplier directory, filtering, and request states. Author review: Done. -->
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
</script>

<template>
  <div class="site-shell">
    <main>
      <section id="suppliers" class="directory" aria-labelledby="directory-title">
        <form class="search-panel" role="search" @submit.prevent="search">
          <div class="search-field">
            <label for="supplier-name">FIND A SUPPLIER</label>
            <div class="input-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>
              <input id="supplier-name" v-model="name" type="search" placeholder="Search by name, e.g. cafe" autocomplete="off">
            </div>
          </div>
          <div class="type-field">
            <label for="supplier-type">WHAT ARE YOU LOOKING FOR?</label>
            <select id="supplier-type" v-model="selectedType">
              <option value="">All types</option>
              <option v-for="type in availableTypes" :key="type" :value="type">{{ type }}</option>
            </select>
          </div>
          <button type="submit" class="primary-button" :disabled="pending">{{ pending ? 'Searching…' : 'Search suppliers' }}<span v-if="!pending" aria-hidden="true">→</span></button>
        </form>

        <div class="directory-heading">
          <div><h2 id="directory-title">{{ hasFilters ? 'Your search results' : 'Explore suppliers' }}</h2>
            <p v-if="!pending && !error" aria-live="polite">{{ suppliers.length }} {{ suppliers.length === 1 ? 'supplier' : 'suppliers' }} <span class="count-divider">/</span> <span class="open-count">{{ openCount }} open now</span></p>
          </div>
          <button v-if="hasFilters" class="clear-button" type="button" @click="reset">Clear filters <span aria-hidden="true">×</span></button>
        </div>

        <div v-if="pending" class="supplier-grid" role="status" aria-label="Loading suppliers">
          <div v-for="item in 6" :key="item" class="supplier-card skeleton-card" aria-hidden="true"><div class="skeleton-avatar"/><div class="skeleton-line"/><div class="skeleton-line short"/></div>
        </div>
        <div v-else-if="error" class="empty-state" role="alert">
          <span class="empty-icon" aria-hidden="true">!</span>
          <h3>We couldn’t load the suppliers.</h3>
          <p>Please try again in a moment.</p>
          <button class="primary-button" type="button" @click="refresh()">Try again <span aria-hidden="true">↻</span></button>
        </div>
        <div v-else-if="!suppliers.length" class="empty-state" role="status">
          <span class="empty-icon" aria-hidden="true">⌕</span>
          <h3>{{ hasFilters ? 'No suppliers found.' : 'No suppliers to show yet.' }}</h3>
          <p>{{ hasFilters ? 'Try a different name or explore all supplier types.' : 'Check back soon for places around campus.' }}</p>
          <button v-if="hasFilters" class="primary-button" type="button" @click="reset">Explore all suppliers <span aria-hidden="true">→</span></button>
        </div>
        <div v-else class="supplier-grid">
          <SupplierCard v-for="supplier in suppliers" :key="supplier.id" :supplier="supplier" />
        </div>
      </section>
    </main>
  </div>
</template>
