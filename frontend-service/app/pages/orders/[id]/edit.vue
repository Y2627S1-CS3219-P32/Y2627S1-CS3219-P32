<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
Scope: Edit order page after the student's mockups (title, description and delivery
location while OPEN). Author review: Pending. -->
<script setup lang="ts">
import type { Order, OrderCreate } from "#shared/services/order-service/types";
import OrderForm from "~/services/order-service/components/OrderForm.vue";
import { useOrderActions, useViewerId } from "~/services/order-service/composables/useOrders";
import { canEdit } from "~/services/order-service/order-view";

definePageMeta({ middleware: "auth" });

const route = useRoute();
const id = String(route.params.id);
const viewerId = useViewerId();
const { data: order, error: loadError } = await useFetch<Order>(`/api/order-service/orders/${encodeURIComponent(id)}`);
const { busy, error, run } = useOrderActions();

async function save(values: OrderCreate) {
  const updated = await run(
    () => $fetch<Order>(`/api/order-service/orders/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { title: values.title, description: values.description, deliveryLocation: values.deliveryLocation },
    }),
    "The order could not be saved. Please try again.",
  );
  if (updated) await navigateTo(`/orders/${id}`);
}
</script>

<template>
  <main class="min-h-screen bg-[#f7f9fc]">
    <div class="mx-auto max-w-2xl px-4 pt-6 pb-24 md:pt-10">
      <h1 class="mb-4 text-center text-4xl font-semibold tracking-tight text-[#111] md:text-5xl">Edit Order</h1>
      <p v-if="loadError" class="text-center text-[#5b6570]">{{ getApiErrorMessage(loadError) ?? "The order could not be loaded." }}</p>
      <template v-else-if="order">
        <OrderForm v-if="canEdit(order, viewerId)" :order="order" :submitting="busy" :error="error" @submit="save" />
        <p v-else class="text-center text-[#5b6570]">
          Only the requester can edit an order, and only while it is open.
          <NuxtLink :to="`/orders/${id}`" class="font-medium text-[#173a73] underline">Back to the order</NuxtLink>
        </p>
      </template>
    </div>
  </main>
</template>
