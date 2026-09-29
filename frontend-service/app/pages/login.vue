<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-29.
Scope: JWT login test page. Author review: Pending. -->
<script setup lang="ts">
import type { User } from "#shared/services/user-service/types";

interface LoginResponse {
  token: string;
}

const email = ref("admin@foc.com");
const password = ref("Password123!");
const token = ref("");
const authenticatedUser = ref<User>();
const pending = ref(false);
const errorMessage = ref("");

async function login() {
  pending.value = true;
  errorMessage.value = "";
  authenticatedUser.value = undefined;
  token.value = "";

  try {
    const response = await $fetch<LoginResponse>("/api/user-service/login", {
      method: "POST",
      body: { email: email.value, password: password.value },
    });
    token.value = response.token;
    authenticatedUser.value = await $fetch<User>("/api/user-service/me", {
      headers: { authorization: `Bearer ${response.token}` },
    });
  } catch {
    errorMessage.value = "Login failed. Check the email and password, then try again.";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-[#f7f9fc] px-6 py-12 text-[#06427e]">
    <section class="w-full max-w-md rounded-xl border border-[#e1e6eb] bg-white p-8 shadow-sm">
      <NuxtLink to="/" class="text-sm font-medium text-[#064784] hover:underline">Friends of Campus</NuxtLink>
      <div class="mt-5 text-3xl font-bold">Welcome Back!</div>

      <form class="mt-7 space-y-5" @submit.prevent="login">
        <div>
          <label for="email" class="mb-1.5 block text-sm font-medium">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            autocomplete="username"
            required
            class="w-full rounded-lg border border-[#cfd5da] px-3 py-2.5 text-[#25313c] focus:border-[#064784] focus:outline-none focus:ring-2 focus:ring-[#064784]/20"
          >
        </div>
        <div>
          <label for="password" class="mb-1.5 block text-sm font-medium">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            class="w-full rounded-lg border border-[#cfd5da] px-3 py-2.5 text-[#25313c] focus:border-[#064784] focus:outline-none focus:ring-2 focus:ring-[#064784]/20"
          >
        </div>

        <p v-if="errorMessage" class="text-sm text-red-700" role="alert">{{ errorMessage }}</p>
        <button
          type="submit"
          :disabled="pending"
          class="w-full rounded-lg bg-[#064784] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#053765] disabled:cursor-wait disabled:opacity-60"
        >
          {{ pending ? "Signing in..." : "Sign in" }}
        </button>
      </form>

      <section v-if="authenticatedUser" class="mt-6 rounded-lg bg-[#eef4fa] p-4" aria-live="polite">
        <h2 class="font-semibold">JWT verified</h2>
        <p class="mt-1 text-sm">{{ authenticatedUser.name }} ({{ authenticatedUser.email }})</p>
        <p class="mt-3 break-all font-mono text-xs text-[#5b6570]">{{ token }}</p>
      </section>

      <p class="mt-6 text-xs text-[#5b6570]">Demo password: <code>Password123!</code></p>
    </section>
  </main>
</template>
