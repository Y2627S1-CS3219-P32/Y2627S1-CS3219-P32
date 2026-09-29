<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
Scope: Shared frontend shell. Author review: Done. -->
<script setup lang="ts">
import type { User } from "#shared/services/user-service/types";

function isUnauthorized(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("statusCode" in error && error.statusCode === 401) return true;
  if ("status" in error && error.status === 401) return true;
  return "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "status" in error.response &&
    error.response.status === 401;
}

const route = useRoute();
const requestFetch = useRequestFetch();
const { data: user } = await useAsyncData<User | null>("navigation-user", async () => {
  try {
    return await requestFetch<User>("/api/user-service/me");
  } catch (error) {
    if (isUnauthorized(error)) return null;
    throw error;
  }
});
</script>

<template>
  <div class="min-h-screen" :class="{ 'pb-16 md:pb-0': route.path !== '/login' }">
    <nav
      v-if="route.path !== '/login'"
      aria-label="Main navigation"
      class="fixed inset-x-0 bottom-0 z-50 border-t border-[#e1e6eb] bg-white/95 shadow-[0_-4px_12px_rgba(6,66,126,0.06)] backdrop-blur md:sticky md:top-0 md:border-t-0 md:border-b md:shadow-sm"
    >
      <div class="mx-auto flex max-w-7xl items-center justify-center gap-2 px-4 py-2 md:justify-between md:px-8 md:py-3">
        <NuxtLink
          to="/"
          class="hidden items-center text-base font-semibold tracking-tight text-[#064784] md:flex"
        >
          Frineds of Campus
        </NuxtLink>

        <div class="flex items-center justify-center gap-2">
          <NuxtLink
            to="/profile"
            :aria-current="route.path === '/profile' ? 'page' : undefined"
            class="rounded-lg px-5 py-2.5 text-sm font-medium transition-colors"
            :class="route.path === '/profile' ? 'bg-[#eef4fa] text-[#064784]' : 'text-[#5b6570] hover:bg-[#f7f9fc] hover:text-[#064784]'"
          >
            Profile
          </NuxtLink>
          <NuxtLink
            v-if="user?.role === 'admin'"
            to="/users"
            :aria-current="route.path === '/users' ? 'page' : undefined"
            class="rounded-lg px-5 py-2.5 text-sm font-medium transition-colors"
            :class="route.path === '/users' ? 'bg-[#eef4fa] text-[#064784]' : 'text-[#5b6570] hover:bg-[#f7f9fc] hover:text-[#064784]'"
          >
            Users
          </NuxtLink>
        </div>
      </div>
    </nav>

    <NuxtPage />
  </div>
</template>
