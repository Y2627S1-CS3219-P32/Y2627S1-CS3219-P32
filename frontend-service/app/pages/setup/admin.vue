<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-30.
Scope: First-administrator bootstrap setup page. Author review: Done. -->
<script setup lang="ts">
import { getApiErrorMessage } from "../../utils/get-api-error-message";

try {
  await useRequestFetch()("/api/user-service/bootstrap");
} catch (error) {
  if (
    typeof error === "object" &&
    error !== null &&
    (("statusCode" in error && error.statusCode === 404) ||
      ("status" in error && error.status === 404))
  ) {
    throw createError({ statusCode: 404, statusMessage: "Page not found" });
  }
  throw error;
}

const name = ref("");
const displayName = ref("");
const email = ref("");
const confirmEmail = ref("");
const password = ref("");
const bootstrapSecret = ref("");
const pending = ref(false);
const errorMessage = ref("");
const complete = ref(false);

async function createAdministrator() {
  errorMessage.value = "";
  pending.value = true;
  try {
    await $fetch("/api/user-service/bootstrap", {
      method: "POST",
      headers: { "x-bootstrap-secret": bootstrapSecret.value },
      body: {
        name: name.value,
        displayName: displayName.value,
        email: email.value,
        confirmEmail: confirmEmail.value,
        password: password.value,
      },
    });
    complete.value = true;
    bootstrapSecret.value = "";
    password.value = "";
  } catch (error) {
    errorMessage.value = getApiErrorMessage(error) ?? "Administrator setup failed. Please try again.";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-[#f7f9fc] px-6 py-12 text-[#06427e]">
    <section class="w-full max-w-md rounded-xl border border-[#e1e6eb] bg-white p-8 shadow-sm">
      <NuxtLink to="/login" class="text-sm font-medium text-[#064784] hover:underline">Return to sign in</NuxtLink>
      <h1 class="mt-5 text-3xl font-bold">First administrator setup</h1>
      <p class="mt-2 text-sm text-[#5b6570]">
        Enter the one-time setup secret supplied by the system administrator.
      </p>

      <p v-if="complete" class="mt-6 text-sm text-green-700" role="status">
        Administrator account created. The one-time setup is now disabled.
        <NuxtLink to="/login" class="font-medium underline">Sign in</NuxtLink>
      </p>

      <form v-else class="mt-7 space-y-5" @submit.prevent="createAdministrator">
        <div>
          <label for="bootstrap-secret" class="mb-1.5 block text-sm font-medium">Setup secret</label>
          <input
            id="bootstrap-secret"
            v-model="bootstrapSecret"
            type="password"
            autocomplete="off"
            required
            class="w-full rounded-lg border border-[#cfd5da] px-3 py-2.5 text-[#25313c] focus:border-[#064784] focus:outline-none focus:ring-2 focus:ring-[#064784]/20"
          >
        </div>
        <div>
          <label for="name" class="mb-1.5 block text-sm font-medium">Name</label>
          <input
            id="name"
            v-model="name"
            autocomplete="name"
            maxlength="100"
            required
            class="w-full rounded-lg border border-[#cfd5da] px-3 py-2.5 text-[#25313c] focus:border-[#064784] focus:outline-none focus:ring-2 focus:ring-[#064784]/20"
          >
        </div>
        <div>
          <label for="display-name" class="mb-1.5 block text-sm font-medium">Display name</label>
          <input
            id="display-name"
            v-model="displayName"
            autocomplete="nickname"
            minlength="2"
            maxlength="50"
            pattern="[A-Za-z][A-Za-z-]*[A-Za-z]"
            required
            class="w-full rounded-lg border border-[#cfd5da] px-3 py-2.5 text-[#25313c] focus:border-[#064784] focus:outline-none focus:ring-2 focus:ring-[#064784]/20"
          >
          <p class="mt-1 text-xs text-[#5b6570]">2–50 letters and hyphens; must begin and end with a letter.</p>
        </div>
        <div>
          <label for="email" class="mb-1.5 block text-sm font-medium">University email</label>
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
        <div>
          <label for="confirm-email" class="mb-1.5 block text-sm font-medium">Confirm email</label>
          <input
            id="confirm-email"
            v-model="confirmEmail"
            type="email"
            autocomplete="off"
            maxlength="254"
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
            autocomplete="new-password"
            minlength="8"
            required
            class="w-full rounded-lg border border-[#cfd5da] px-3 py-2.5 text-[#25313c] focus:border-[#064784] focus:outline-none focus:ring-2 focus:ring-[#064784]/20"
          >
          <p class="mt-1 text-xs text-[#5b6570]">At least 8 characters, with uppercase, lowercase, and a number.</p>
        </div>

        <p v-if="errorMessage" class="text-sm text-red-700" role="alert">{{ errorMessage }}</p>
        <button
          type="submit"
          :disabled="pending"
          class="w-full rounded-lg bg-[#064784] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#053765] disabled:cursor-wait disabled:opacity-60"
        >
          {{ pending ? "Creating administrator..." : "Create first administrator" }}
        </button>
      </form>
    </section>
  </main>
</template>
