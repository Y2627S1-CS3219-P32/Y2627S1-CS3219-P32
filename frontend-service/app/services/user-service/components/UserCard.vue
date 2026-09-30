<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-30.
Scope: User card displaying display name, name, and email. Author review: Done. -->
<script setup lang="ts">
import type { User } from "#shared/services/user-service/types";

defineProps<{ user: User }>();
</script>

<template>
  <article class="rounded-lg border border-[#e1e6eb] bg-white p-5 shadow-sm">
    <h2 class="text-lg font-semibold">{{ user.displayName || user.name }}</h2>
    <p v-if="user.displayName" class="mt-1 text-sm text-[#5b6570]">{{ user.name }}</p>
    <p class="mt-1 text-sm text-[#5b6570]">{{ user.email }}</p>
    <p class="mt-4 inline-flex rounded-full bg-[#eef4fa] px-3 py-1 text-xs font-medium capitalize">
      {{ user.role }}
    </p>
  </article>
</template>
