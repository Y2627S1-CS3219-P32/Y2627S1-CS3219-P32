<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
Scope: New order page after the student's mockups. Author review: Pending. -->
<script setup lang="ts">
import type { Order, OrderCreate } from "#shared/services/order-service/types";
import type { Supplier } from "#shared/services/supplier-service/types";
import OrderForm from "~/services/order-service/components/OrderForm.vue";
import { useOrderActions } from "~/services/order-service/composables/useOrders";

definePageMeta({ middleware: "auth" });

const { data: suppliers } = await useFetch<Supplier[]>("/api/supplier-service/suppliers", { default: () => [] });
const { busy, error, run } = useOrderActions();

async function create(values: OrderCreate) {
  const order = await run(
    () => $fetch<Order>("/api/order-service/orders", { method: "POST", body: values }),
    "The order could not be created. Please try again.",
  );
  if (order) await navigateTo(`/orders/${order.id}`);
}
</script>

<template>
  <main class="min-h-screen bg-[#f7f9fc]">
    <div class="mx-auto max-w-2xl px-4 pt-6 pb-24 md:pt-10">
      <h1 class="mb-4 text-center text-4xl font-semibold tracking-tight text-[#111] md:text-5xl">New Order</h1>
      <OrderForm :suppliers="suppliers" :submitting="busy" :error="error" @submit="create" />
    </div>
  </main>
</template>
