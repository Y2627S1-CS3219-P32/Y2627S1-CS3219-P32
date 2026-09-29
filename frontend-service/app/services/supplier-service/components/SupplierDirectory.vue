<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28; Claude Code (Opus 5.5), 2026-09-29.
Scope: Supplier directory, filtering, and request states; Tailwind styling. Author review: Done. -->
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

const primaryButton = "inline-flex items-center justify-center gap-[13px] rounded-lg border-0 bg-[#225c40] p-[15px] text-[13px] font-semibold text-white transition-colors duration-[160ms] hover:bg-[#18482f] min-[1000px]:gap-[25px] min-[1000px]:px-5 min-[1000px]:py-4";
const fieldLabel = "mb-[9px] block text-[9px] font-bold tracking-[1.3px] text-[#758270]";
const supplierGrid = "grid grid-cols-1 gap-[14px] min-[480px]:grid-cols-2 min-[700px]:gap-[19px] min-[1000px]:grid-cols-3 min-[1500px]:gap-[22px]";
const emptyState = "rounded-xl border border-dashed border-[#cbd8c2] bg-[#ffffff85] px-5 py-[54px] text-center";
const emptyIcon = "mx-auto mb-4 flex size-[46px] items-center justify-center rounded-full bg-[#eaf0e3] text-[24px] text-[#6d8765]";
</script>

<template>
  <div class="mx-auto max-w-[1280px] px-5 min-[700px]:px-8 min-[1000px]:px-12 min-[1500px]:max-w-[1360px]">
    <main>
      <section id="suppliers" class="scroll-mt-5" aria-labelledby="directory-title">
        <form class="grid grid-cols-1 items-center gap-5 rounded-xl border border-[#dde3d9] bg-white p-5 shadow-[0_6px_25px_#2d4a3410] min-[700px]:grid-cols-[minmax(180px,1.2fr)_minmax(150px,1fr)_auto] min-[700px]:gap-[18px] min-[700px]:px-[22px] min-[700px]:py-[21px] min-[1000px]:grid-cols-[minmax(200px,1.25fr)_minmax(200px,1fr)_auto] min-[1000px]:gap-6" role="search" @submit.prevent="search">
          <div>
            <label for="supplier-name" :class="fieldLabel">FIND A SUPPLIER</label>
            <div class="flex items-center gap-3">
              <svg class="size-[19px] shrink-0 text-[#7e8e7d]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>
              <input id="supplier-name" v-model="name" type="search" placeholder="Search by name, e.g. cafe" autocomplete="off" class="w-full min-w-0 rounded-lg border-0 bg-transparent px-0 py-0.5 text-[14px] text-[#263e2f] placeholder:text-[#889185]">
            </div>
          </div>
          <div class="border-t border-[#dde3d9] pt-[17px] min-[700px]:border-t-0 min-[700px]:border-l min-[700px]:pt-0 min-[700px]:pl-[18px] min-[1000px]:pl-6">
            <label for="supplier-type" :class="fieldLabel">WHAT ARE YOU LOOKING FOR?</label>
            <select id="supplier-type" v-model="selectedType" class="w-full rounded-lg border-0 bg-white py-0 pr-[5px] pl-0 text-[14px] text-[#3d4e3d]">
              <option value="">All types</option>
              <option v-for="type in availableTypes" :key="type" :value="type">{{ type }}</option>
            </select>
          </div>
          <button type="submit" :class="[primaryButton, 'max-[700px]:w-full max-[700px]:justify-between']" :disabled="pending">{{ pending ? 'Searching…' : 'Search suppliers' }}<span v-if="!pending" class="text-[19px] leading-none" aria-hidden="true">→</span></button>
        </form>

        <div class="mt-[30px] mb-[23px] flex items-center justify-between gap-4 min-[700px]:mt-[39px]">
          <div><h2 id="directory-title" class="mb-[9px] text-[20px] font-[550] tracking-[-0.5px] min-[700px]:text-[23px]">{{ hasFilters ? 'Your search results' : 'Explore suppliers' }}</h2>
            <p v-if="!pending && !error" class="text-[12px] text-[#77816f]" aria-live="polite">{{ suppliers.length }} {{ suppliers.length === 1 ? 'supplier' : 'suppliers' }} <span class="mx-[9px] text-[#bdc6b7]">/</span> <span class="text-[#598361]">{{ openCount }} open now</span></p>
          </div>
          <button v-if="hasFilters" class="flex items-center gap-3.5 rounded-lg border-0 bg-transparent text-[13px] text-[#446d4d]" type="button" @click="reset">Clear filters <span class="text-[21px]" aria-hidden="true">×</span></button>
        </div>

        <div v-if="pending" :class="supplierGrid" role="status" aria-label="Loading suppliers">
          <div v-for="item in 6" :key="item" class="flex min-h-[270px] min-w-0 flex-col rounded-xl border border-[#dde3d9] bg-white p-[23px] min-[480px]:max-[700px]:p-[17px] min-[1500px]:p-[26px]" aria-hidden="true">
            <div class="mb-[26px] size-[58px] rounded-xl bg-[#eff2eb]"/>
            <div class="mb-[13px] h-[17px] w-[85%] rounded-[5px] bg-[#eff2eb]"/>
            <div class="mb-[13px] h-3 w-[60%] rounded-[5px] bg-[#eff2eb]"/>
          </div>
        </div>
        <div v-else-if="error" :class="emptyState" role="alert">
          <span :class="emptyIcon" aria-hidden="true">!</span>
          <h3 class="mb-2.5 text-[23px] font-[550]">We couldn’t load the suppliers.</h3>
          <p class="mb-[25px] text-[14px] text-[#74806f]">Please try again in a moment.</p>
          <button :class="primaryButton" type="button" @click="refresh()">Try again <span class="text-[19px] leading-none" aria-hidden="true">↻</span></button>
        </div>
        <div v-else-if="!suppliers.length" :class="emptyState" role="status">
          <span :class="emptyIcon" aria-hidden="true">⌕</span>
          <h3 class="mb-2.5 text-[23px] font-[550]">{{ hasFilters ? 'No suppliers found.' : 'No suppliers to show yet.' }}</h3>
          <p class="mb-[25px] text-[14px] text-[#74806f]">{{ hasFilters ? 'Try a different name or explore all supplier types.' : 'Check back soon for places around campus.' }}</p>
          <button v-if="hasFilters" :class="primaryButton" type="button" @click="reset">Explore all suppliers <span class="text-[19px] leading-none" aria-hidden="true">→</span></button>
        </div>
        <div v-else :class="supplierGrid">
          <SupplierCard v-for="supplier in suppliers" :key="supplier.id" :supplier="supplier" />
        </div>
      </section>
    </main>
  </div>
</template>
