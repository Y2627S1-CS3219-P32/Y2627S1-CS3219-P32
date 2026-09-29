<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-29.
Scope: Student account registration page. Author review: Done. -->
<script setup lang="ts">
const name = ref("");
const email = ref("");
const confirmEmail = ref("");
const password = ref("");
const pending = ref(false);
const errorMessage = ref("");

function getErrorMessage(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const errorRecord = error as Record<string, unknown>;

  if ("data" in errorRecord) {
    const message = getErrorMessage(errorRecord.data);
    if (message) return message;
  }
  const response = errorRecord.response;
  if (typeof response === "object" && response !== null) {
    if ("_data" in response) {
      const message = getErrorMessage(response._data);
      if (message) return message;
    }
  }
  for (const key of ["error", "message", "statusMessage"]) {
    const value = errorRecord[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
}

async function register() {
  errorMessage.value = "";
  if (email.value.trim().toLowerCase() !== confirmEmail.value.trim().toLowerCase()) {
    errorMessage.value = "Email addresses do not match.";
    return;
  }

  pending.value = true;
  try {
    await $fetch("/api/user-service/register", {
      method: "POST",
      body: {
        name: name.value,
        email: email.value,
        confirmEmail: confirmEmail.value,
        password: password.value,
      },
    });
    clearNuxtData("navigation-user");
    await navigateTo("/profile");
  } catch (error) {
    errorMessage.value = getErrorMessage(error) ?? "Account creation failed. Please try again.";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-[#f7f9fc] px-6 py-12 text-[#06427e]">
    <section class="w-full max-w-md rounded-xl border border-[#e1e6eb] bg-white p-8 shadow-sm">
      <NuxtLink to="/" class="text-sm font-medium text-[#064784] hover:underline">Return to home page</NuxtLink>
      <div class="mt-5 text-3xl font-bold">Create your account</div>
      <p class="mt-2 text-sm text-[#5b6570]">Join Friends of Campus today!</p>

      <form class="mt-7 space-y-5" @submit.prevent="register">
        <div>
          <label for="name" class="mb-1.5 block text-sm font-medium">Name</label>
          <input
            id="name"
            v-model="name"
            type="text"
            autocomplete="name"
            maxlength="100"
            required
            class="w-full rounded-lg border border-[#cfd5da] px-3 py-2.5 text-[#25313c] focus:border-[#064784] focus:outline-none focus:ring-2 focus:ring-[#064784]/20"
          >
        </div>
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
          <p class="mt-1 text-xs text-[#5b6570]">Use at least 8 characters.</p>
        </div>

        <p v-if="errorMessage" class="text-sm text-red-700" role="alert">{{ errorMessage }}</p>
        <button
          type="submit"
          :disabled="pending"
          class="w-full rounded-lg bg-[#064784] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#053765] disabled:cursor-wait disabled:opacity-60"
        >
          {{ pending ? "Creating account..." : "Create account" }}
        </button>
      </form>

      <p class="mt-6 text-center text-sm text-[#5b6570]">
        Already have an account?
        <NuxtLink to="/login" class="font-medium text-[#064784] hover:underline">Sign in</NuxtLink>
      </p>
    </section>
  </main>
</template>
