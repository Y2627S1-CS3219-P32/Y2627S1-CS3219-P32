<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-30.
Scope: Read-only profile summary and logout. Author review: Done. -->
<script setup lang="ts">
import CreditBalance from "~/services/credit-service/components/CreditBalance.vue";
import type { User } from "#shared/services/user-service/types";

definePageMeta({ middleware: "auth" });

const requestFetch = useRequestFetch();
const { data: user } = await useAsyncData<User>(
  "user-profile",
  () => requestFetch("/api/user-service/me"),
);

async function logout() {
  await $fetch("/api/user-service/logout", { method: "POST" });
  clearNuxtData("navigation-user");
  await navigateTo("/login");
}
</script>

<template>
  <main class="min-h-screen bg-[#f7f9fc] px-6 py-12 text-[#06427e] sm:px-12">
    <section class="mx-auto w-full max-w-2xl rounded-xl border border-[#e1e6eb] bg-white p-5 shadow-sm sm:p-8">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold sm:text-3xl">Your profile</h1>
        </div>
        <button
          type="button"
          class="min-h-11 shrink-0 rounded-lg border border-[#cfd5da] px-4 py-2 text-sm font-medium text-[#064784] hover:bg-[#f7f9fc]"
          @click="logout"
        >
          Log out
        </button>
      </div>

      <CreditBalance v-if="user" :user-id="user.id" class="mt-8" />

      <dl v-if="user" class="mt-8 divide-y divide-[#e1e6eb] rounded-lg border border-[#e1e6eb]">
        <div class="grid gap-1 px-4 py-3 sm:grid-cols-[8rem_1fr]">
          <dt class="text-sm text-[#5b6570]">Display name</dt>
          <dd class="font-medium">{{ user.displayName }}</dd>
        </div>
        <div class="grid gap-1 px-4 py-3 sm:grid-cols-[8rem_1fr]">
          <dt class="text-sm text-[#5b6570]">Name</dt>
          <dd class="font-medium">{{ user.name }}</dd>
        </div>
        <div class="grid gap-1 px-4 py-3 sm:grid-cols-[8rem_1fr]">
          <dt class="text-sm text-[#5b6570]">Email</dt>
          <dd class="font-medium">{{ user.email }}</dd>
        </div>
        <div class="grid gap-1 px-4 py-3 sm:grid-cols-[8rem_1fr]">
          <dt class="text-sm text-[#5b6570]">Role</dt>
          <dd class="font-medium capitalize">{{ user.role }}</dd>
        </div>
      </dl>

      <NuxtLink
        to="/profile/edit"
        class="mt-6 inline-flex rounded-lg bg-[#064784] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#053765]"
      >
        Edit profile
      </NuxtLink>
    </section>
  </main>
</template>
