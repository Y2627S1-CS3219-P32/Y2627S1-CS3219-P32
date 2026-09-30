<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-29.
Scope: JWT login test page. Author review: Done. -->
<script setup lang="ts">
import { getApiErrorMessage } from "../utils/get-api-error-message";

const route = useRoute();

const email = ref("admin@foc.com");
const password = ref("Password123!");
const pending = ref(false);
const errorMessage = ref("");

async function login() {
  pending.value = true;
  errorMessage.value = "";

  try {
    await $fetch("/api/user-service/login", {
      method: "POST",
      body: { email: email.value, password: password.value },
    });
    const redirect = typeof route.query.redirect === "string" &&
      route.query.redirect.startsWith("/") &&
      !route.query.redirect.startsWith("//")
      ? route.query.redirect
      : "/profile";
    await refreshNuxtData("navigation-user");
    await navigateTo(redirect);
  } catch (error) {
    errorMessage.value = getApiErrorMessage(error) ?? "Login failed. Check the email and password, then try again.";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-[#f7f9fc] px-6 py-12 text-[#06427e]">
    <section class="w-full max-w-md rounded-xl border border-[#e1e6eb] bg-white p-8 shadow-sm">
      <NuxtLink to="/" class="text-sm font-medium text-[#064784] hover:underline">Return to home page</NuxtLink>
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

      <p class="mt-6 text-center text-sm text-[#5b6570]">
        New here?
        <NuxtLink to="/signup" class="font-medium text-[#064784] hover:underline">Create an account</NuxtLink>
      </p>

      <p class="mt-6 text-xs text-[#5b6570]">Demo password: <code>Password123!</code></p>
    </section>
  </main>
</template>
