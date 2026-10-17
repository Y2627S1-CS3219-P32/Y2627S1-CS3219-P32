<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
Scope: New and edit order form after the student's mockups. The supplier and reward are
fixed once an order exists. Author review: Pending. -->
<script setup lang="ts">
import type { Order, OrderCreate } from "#shared/services/order-service/types";
import type { Supplier } from "#shared/services/supplier-service/types";

const props = defineProps<{
  order?: Order;
  suppliers?: Supplier[];
  submitting: boolean;
  error: string;
}>();
const emit = defineEmits<{ submit: [values: OrderCreate] }>();

const MAX_TITLE = 100;
const MAX_DESCRIPTION = 500;
const MAX_LOCATION = 256;

const editing = computed(() => Boolean(props.order));
const title = ref(props.order?.title ?? "");
const supplierId = ref(props.order?.supplier.id ?? "");
const deliveryLocation = ref(props.order?.deliveryLocation ?? "");
const description = ref(props.order?.description ?? "");
const reward = ref(props.order?.creditReward ?? 10);

const activeSuppliers = computed(() => (props.suppliers ?? []).filter(supplier => supplier.isActive));
const supplierLabel = (supplier: Supplier) => supplier.buildingName ? `${supplier.name} (${supplier.buildingName})` : supplier.name;

function setReward(value: number) {
  reward.value = Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
}

function submit() {
  emit("submit", {
    supplierId: supplierId.value,
    title: title.value.trim(),
    description: description.value.trim(),
    deliveryLocation: deliveryLocation.value.trim(),
    creditReward: reward.value,
  });
}

const field = "min-w-0 flex-1 rounded-none bg-[#f3f3f3] px-3 py-2 text-[15px] text-[#111] outline-none placeholder:text-[#a6abb1] focus:bg-[#eceff3] focus-visible:outline-2 focus-visible:outline-[#3b78c4]";
</script>

<template>
  <form class="space-y-4 rounded-md bg-white p-5 shadow-[0_2px_8px_rgba(0,0,0,0.14)] md:p-6" @submit.prevent="submit">
    <label class="flex items-center gap-3">
      <span class="shrink-0 font-semibold text-[#111]">Title:</span>
      <input v-model="title" :class="field" :maxlength="MAX_TITLE" required autocomplete="off">
    </label>

    <label v-if="!editing" class="flex items-center gap-3">
      <span class="shrink-0 font-semibold text-[#111]">Pickup:</span>
      <select v-model="supplierId" :class="field" required>
        <option value="" disabled>Choose a supplier</option>
        <option v-for="supplier in activeSuppliers" :key="supplier.id" :value="supplier.id">{{ supplierLabel(supplier) }}</option>
      </select>
    </label>
    <p v-else class="flex items-center gap-3">
      <span class="shrink-0 font-semibold text-[#111]">Pickup:</span>
      <span class="text-[15px] text-[#5b6570]">{{ order?.supplier.name }}</span>
    </p>

    <label class="flex items-center gap-3">
      <span class="shrink-0 font-semibold text-[#111]">Deliver to:</span>
      <input v-model="deliveryLocation" :class="field" :maxlength="MAX_LOCATION" placeholder="e.g., PGP Foyer, COM3" required autocomplete="off">
    </label>

    <label class="block">
      <span class="mb-2 block font-semibold text-[#111]">Description ({{ description.length }}/{{ MAX_DESCRIPTION }}):</span>
      <textarea v-model="description" :class="field" class="block h-40 w-full resize-y" :maxlength="MAX_DESCRIPTION" required />
    </label>

    <div class="flex items-center gap-3">
      <span class="w-20 shrink-0 font-semibold text-[#111]" id="reward-label">Reward:</span>
      <template v-if="!editing">
        <button type="button" class="size-9 bg-[#f2c9c9] text-lg font-semibold text-[#111]" aria-label="Decrease reward" :disabled="reward <= 1" @click="setReward(reward - 1)">−</button>
        <input
          :value="reward"
          type="number"
          min="1"
          step="1"
          aria-labelledby="reward-label"
          class="w-16 bg-transparent text-center text-lg text-[#111] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
          @change="setReward(Number(($event.target as HTMLInputElement).value))"
        >
        <button type="button" class="size-9 bg-[#cfe5d6] text-lg font-semibold text-[#111]" aria-label="Increase reward" @click="setReward(reward + 1)">+</button>
      </template>
      <template v-else>
        <span class="text-lg text-[#111]">{{ reward }}</span>
        <span class="text-sm text-[#8a9099]">Fixed once the order is created</span>
      </template>
    </div>

    <p v-if="error" role="alert" class="rounded-md bg-[#fdf2f2] px-3 py-2 text-sm text-[#c62828]">{{ error }}</p>

    <div class="flex justify-center pt-2">
      <button
        type="submit"
        :disabled="submitting"
        class="relative w-full max-w-xs rounded-md bg-[#173a73] px-10 py-3 text-sm font-medium text-white hover:bg-[#10305f]"
      >
        {{ editing ? "Edit Order" : "Create Order" }}
        <span class="absolute top-1/2 right-5 -translate-y-1/2" aria-hidden="true">→</span>
      </button>
    </div>
  </form>
</template>
