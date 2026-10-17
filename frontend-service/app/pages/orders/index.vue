<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
Scope: Route entry point for the orders page. Author review: Pending. -->
<script setup lang="ts">
import OrderBoard from "~/services/order-service/components/OrderBoard.vue";

definePageMeta({ middleware: "auth" });
</script>

<template>
  <OrderBoard />
</template>
