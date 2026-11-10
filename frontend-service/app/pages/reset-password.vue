<!-- AI Assistance Disclosure: Copilot SDK in VS Code, 2026-11-05.
Scope: Set a new password from a reset link. Author review: Pending. -->
<script setup lang="ts">
import { getApiErrorMessage } from "../utils/get-api-error-message";

const route = useRoute();
const password = ref("");
const confirmPassword = ref("");
const pending = ref(false);
const errorMessage = ref("");
const token = computed(() => typeof route.query.token === "string" ? route.query.token : "");
const passwordMeetsCriteria = computed(() =>
  [...password.value].length >= 8 &&
  /[A-Z]/.test(password.value) &&
  /[a-z]/.test(password.value) &&
  /[0-9]/.test(password.value),
);

async function resetPassword() {
  errorMessage.value = "";
  if (!token.value) {
    errorMessage.value = "This password reset link is invalid or has expired.";
    return;
  }
  if (!passwordMeetsCriteria.value) {
    errorMessage.value = "Choose a password with 8 characters, an uppercase letter, a lowercase letter, and a number.";
    return;
  }
  if (password.value !== confirmPassword.value) {
    errorMessage.value = "Passwords do not match.";
    return;
  }

  pending.value = true;
  try {
    await $fetch(
      "/api/user-service/password-reset/complete",
      {
        method: "POST",
        body: { token: token.value, password: password.value },
      },
    );
    await navigateTo({
      path: "/login",
      query: { passwordReset: "1" },
    });
  } catch (error) {
    errorMessage.value = getApiErrorMessage(error) ?? "Your password could not be reset. Request a new link and try again.";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-[#f7f9fc] px-6 py-12 text-[#06427e]">
    <section class="w-full max-w-md rounded-xl border border-[#e1e6eb] bg-white p-8 shadow-sm">
      <NuxtLink to="/login" class="text-sm font-medium text-[#064784] hover:underline">Back to sign in</NuxtLink>
      <h1 class="mt-5 text-3xl font-bold">Reset your password</h1>
      <p class="mt-3 text-sm text-[#5b6570]">Choose a new password for your account.</p>

      <form class="mt-7 space-y-5" @submit.prevent="resetPassword">
        <div>
          <label for="password" class="mb-1.5 block text-sm font-medium">New password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            autocomplete="new-password"
            minlength="8"
            required
            class="w-full rounded-lg border border-[#cfd5da] px-3 py-2.5 text-[#25313c] focus:border-[#064784] focus:outline-none focus:ring-2 focus:ring-[#064784]/20"
          >
          <p
            class="mt-1 text-xs"
            :class="passwordMeetsCriteria ? 'text-green-700' : 'text-[#5b6570]'"
            aria-live="polite"
          >
            {{ passwordMeetsCriteria
              ? "Password meets the requirements."
              : "Password must include 8 characters, an uppercase letter, a lowercase letter, and a number." }}
          </p>
        </div>
        <div>
          <label for="confirm-password" class="mb-1.5 block text-sm font-medium">Confirm new password</label>
          <input
            id="confirm-password"
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
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
          {{ pending ? "Updating password..." : "Reset password" }}
        </button>
      </form>
    </section>
  </main>
</template>
