<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
Scope: Route entry point for the supplier directory. Author review: Done.
Claude Code (Opus 5.5), 2026-09-29. Scope: Require login. Author review: Done. -->
<script setup lang="ts">
import SupplierDirectory from "~/services/supplier-service/components/SupplierDirectory.vue";

definePageMeta({ middleware: "auth" });
</script>

<template>
  <SupplierDirectory />
</template>
