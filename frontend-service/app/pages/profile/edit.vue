<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-30.
Scope: Authenticated account editing page. Author review: Done. -->
<script setup lang="ts">
import type { User } from "#shared/services/user-service/types";
import { getApiErrorMessage } from "../../utils/get-api-error-message";

definePageMeta({ middleware: "auth" });

const requestFetch = useRequestFetch();
const { data: user } = await useAsyncData<User>(
  "user-profile",
  () => requestFetch("/api/user-service/me"),
);

const displayName = ref(user.value?.displayName ?? "");
const email = ref(user.value?.email ?? "");
const confirmEmail = ref("");
const currentPassword = ref("");
const newPassword = ref("");
const pending = ref(false);
const errorMessage = ref("");
const successMessage = ref("");
const passwordMeetsCriteria = computed(() =>
  [...newPassword.value].length >= 8 &&
  /[A-Z]/.test(newPassword.value) &&
  /[a-z]/.test(newPassword.value) &&
  /[0-9]/.test(newPassword.value),
);

async function saveProfile() {
  errorMessage.value = "";
  successMessage.value = "";
  const body: Record<string, string> = {};
  if (displayName.value !== user.value?.displayName) body.displayName = displayName.value;
  if (email.value.trim().toLowerCase() !== user.value?.email) {
    body.email = email.value;
    body.confirmEmail = confirmEmail.value;
  }
  if (currentPassword.value || newPassword.value) {
    body.currentPassword = currentPassword.value;
    body.newPassword = newPassword.value;
  }
  if (Object.keys(body).length === 0) {
    errorMessage.value = "Make a change before saving.";
    return;
  }

  pending.value = true;
  try {
    const updatedUser = await $fetch<User>("/api/user-service/me", {
      method: "PATCH",
      body,
    });
    user.value = updatedUser;
    displayName.value = updatedUser.displayName;
    email.value = updatedUser.email;
    confirmEmail.value = "";
    currentPassword.value = "";
    newPassword.value = "";
    successMessage.value = "Your account details have been updated.";
    await refreshNuxtData("navigation-user");
  } catch (error) {
    errorMessage.value = getApiErrorMessage(error) ?? "Your account details could not be updated.";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <main class="min-h-screen bg-[#f7f9fc] px-6 py-12 text-[#06427e] sm:px-12">
    <section class="mx-auto w-full max-w-2xl rounded-xl border border-[#e1e6eb] bg-white p-8 shadow-sm">
      <NuxtLink to="/profile" class="text-sm font-medium text-[#064784] hover:underline">Back to profile</NuxtLink>
      <h1 class="mt-5 text-3xl font-bold">Edit profile</h1>

      <form class="mt-8 space-y-5" @submit.prevent="saveProfile">
        <h2 class="text-lg font-semibold">Account details</h2>
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
          <p class="mt-1 text-xs text-[#5b6570]">Use an address ending in @u.nus.edu, @nus.edu.sg, or @foc.com.</p>
        </div>
        <div v-if="email.trim().toLowerCase() !== user?.email">
          <label for="confirm-email" class="mb-1.5 block text-sm font-medium">Confirm new email</label>
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

        <h2 class="pt-2 text-lg font-semibold">Change password</h2>
        <div>
          <label for="current-password" class="mb-1.5 block text-sm font-medium">Current password</label>
          <input
            id="current-password"
            v-model="currentPassword"
            type="password"
            autocomplete="current-password"
            class="w-full rounded-lg border border-[#cfd5da] px-3 py-2.5 text-[#25313c] focus:border-[#064784] focus:outline-none focus:ring-2 focus:ring-[#064784]/20"
          >
        </div>
        <div>
          <label for="new-password" class="mb-1.5 block text-sm font-medium">New password</label>
          <input
            id="new-password"
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            minlength="8"
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

        <p v-if="errorMessage" class="text-sm text-red-700" role="alert">{{ errorMessage }}</p>
        <p v-if="successMessage" class="text-sm text-green-700" role="status">{{ successMessage }}</p>
        <div class="flex flex-wrap gap-3">
          <button
            type="submit"
            :disabled="pending"
            class="rounded-lg bg-[#064784] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#053765] disabled:cursor-wait disabled:opacity-60"
          >
            {{ pending ? "Saving..." : "Save changes" }}
          </button>
          <NuxtLink
            to="/profile"
            class="rounded-lg border border-[#cfd5da] px-4 py-2.5 text-sm font-medium text-[#064784] hover:bg-[#f7f9fc]"
          >
            Cancel
          </NuxtLink>
        </div>
      </form>
    </section>
  </main>
</template>
