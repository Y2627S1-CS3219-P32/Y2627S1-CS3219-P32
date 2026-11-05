<!-- AI Assistance Disclosure: Copilot SDK in VS Code, 2026-11-05.
Scope: Request password reset email. Author review: Pending. -->
<script setup lang="ts">
import { getApiErrorMessage } from "../utils/get-api-error-message";

const email = ref("");
const pending = ref(false);
const errorMessage = ref("");
const successMessage = ref("");

async function requestReset() {
  pending.value = true;
  errorMessage.value = "";
  successMessage.value = "";
  try {
    const response = await $fetch<{ message: string }>(
      "/api/user-service/password-reset/request",
      { method: "POST", body: { email: email.value } },
    );
    successMessage.value = response.message;
  } catch (error) {
    errorMessage.value = getApiErrorMessage(error) ?? "The request could not be completed. Please try again.";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-[#f7f9fc] px-6 py-12 text-[#06427e]">
    <section class="w-full max-w-md rounded-xl border border-[#e1e6eb] bg-white p-8 shadow-sm">
      <NuxtLink to="/login" class="text-sm font-medium text-[#064784] hover:underline">Back to sign in</NuxtLink>
      <h1 class="mt-5 text-3xl font-bold">Forgot password?</h1>
      <p class="mt-3 text-sm text-[#5b6570]">
        Enter your account email and we’ll send a link to reset your password.
      </p>

      <form class="mt-7 space-y-5" @submit.prevent="requestReset">
        <div>
          <label for="email" class="mb-1.5 block text-sm font-medium">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            autocomplete="email"
            maxlength="254"
            required
            class="w-full rounded-lg border border-[#cfd5da] px-3 py-2.5 text-[#25313c] focus:border-[#064784] focus:outline-none focus:ring-2 focus:ring-[#064784]/20"
          >
        </div>
        <p v-if="errorMessage" class="text-sm text-red-700" role="alert">{{ errorMessage }}</p>
        <p v-if="successMessage" class="text-sm text-green-700" role="status">{{ successMessage }}</p>
        <button
          type="submit"
          :disabled="pending"
          class="w-full rounded-lg bg-[#064784] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#053765] disabled:cursor-wait disabled:opacity-60"
        >
          {{ pending ? "Sending..." : "Send reset link" }}
        </button>
      </form>
    </section>
  </main>
</template>
