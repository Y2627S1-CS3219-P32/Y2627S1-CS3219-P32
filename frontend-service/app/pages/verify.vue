<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-11-04.
Scope: Let newly registered users submit their account verification code. Author review: Pending. -->
<script setup lang="ts">
import { getApiErrorMessage } from "../utils/get-api-error-message";

const route = useRoute();
const email = ref(typeof route.query.email === "string" ? route.query.email : "");
const verificationCode = ref("");
const pending = ref(false);
const errorMessage = ref("");

async function verify() {
  pending.value = true;
  errorMessage.value = "";
  try {
    await $fetch("/api/user-service/verify", {
      method: "POST",
      body: { email: email.value, verificationCode: verificationCode.value },
    });
    await navigateTo({
      path: "/login",
      query: { email: email.value.trim().toLowerCase(), verified: "1" },
    });
  } catch (error) {
    errorMessage.value = getApiErrorMessage(error) ?? "Verification failed. Check your email and code.";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-[#f7f9fc] px-6 py-12 text-[#06427e]">
    <section class="w-full max-w-md rounded-xl border border-[#e1e6eb] bg-white p-8 shadow-sm">
      <NuxtLink to="/" class="text-sm font-medium text-[#064784] hover:underline">Return to home page</NuxtLink>
      <h1 class="mt-5 text-3xl font-bold">Verify your account</h1>
      <p class="mt-3 text-sm text-[#5b6570]">
        Enter your email and the six-digit verification code provided by an administrator.
      </p>
      <form class="mt-7 space-y-5" @submit.prevent="verify">
        <div>
          <label for="email" class="mb-1.5 block text-sm font-medium">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            autocomplete="email"
            required
            class="w-full rounded-lg border border-[#cfd5da] px-3 py-2.5 text-[#25313c] focus:border-[#064784] focus:outline-none focus:ring-2 focus:ring-[#064784]/20"
          >
        </div>
        <div>
          <label for="verification-code" class="mb-1.5 block text-sm font-medium">Verification code</label>
          <input
            id="verification-code"
            v-model="verificationCode"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9]{6}"
            maxlength="6"
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
          {{ pending ? "Verifying..." : "Verify account" }}
        </button>
      </form>
    </section>
  </main>
</template>
