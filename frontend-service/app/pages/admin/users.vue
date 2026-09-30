<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-30.
Scope: Administrator user management controls. Author review: Done. -->
<script setup lang="ts">
import { getApiErrorMessage } from "../../utils/get-api-error-message";
import { useUsers } from "../../services/user-service/composables/useUsers";
import type { User } from "#shared/services/user-service/types";

const { data: users, pending, error, refresh } = await useUsers();
const requestFetch = useRequestFetch();
const { data: currentUser, error: currentUserError } = await useAsyncData<User>(
  "admin-current-user",
  () => requestFetch("/api/user-service/me"),
);
const pendingUserId = ref<number | null>(null);
const actionError = ref("");
const actionMessage = ref("");

async function changeRole(user: User) {
  const nextRole = user.role === "admin" ? "student" : "admin";
  const action = nextRole === "admin" ? "promote" : "demote";
  if (!window.confirm(`Are you sure you want to ${action} ${user.displayName || user.name}?`)) return;

  pendingUserId.value = user.id;
  actionError.value = "";
  actionMessage.value = "";
  try {
    await $fetch(`/api/user-service/users/${encodeURIComponent(user.id)}`, {
      method: "PUT",
      body: { role: nextRole },
    });
    await refresh();
    actionMessage.value = `${user.displayName || user.name} is now ${nextRole === "admin" ? "an admin" : "a student"}.`;
  } catch (error) {
    actionError.value = getApiErrorMessage(error) ?? `Unable to ${action} this account.`;
  } finally {
    pendingUserId.value = null;
  }
}

async function removeUser(user: User) {
  if (!window.confirm(`Delete ${user.displayName || user.name}? This cannot be undone.`)) return;

  pendingUserId.value = user.id;
  actionError.value = "";
  actionMessage.value = "";
  try {
    await $fetch(`/api/user-service/users/${encodeURIComponent(user.id)}`, {
      method: "DELETE",
    });
    await refresh();
    actionMessage.value = `${user.displayName || user.name} was deleted.`;
  } catch (error) {
    actionError.value = getApiErrorMessage(error) ?? "Unable to delete this account.";
  } finally {
    pendingUserId.value = null;
  }
}
</script>

<template>
  <main class="min-h-screen bg-[#f7f9fc] px-6 py-12 text-[#06427e] sm:px-12">
    <section class="mx-auto w-full max-w-4xl">
      <div class="text-3xl font-bold">Users</div>

      <p v-if="actionError" class="mt-5 rounded-lg border border-red-200 bg-white p-4 text-sm text-red-700" role="alert">
        {{ actionError }}
      </p>
      <p v-if="actionMessage" class="mt-5 rounded-lg border border-green-200 bg-white p-4 text-sm text-green-700" role="status">
        {{ actionMessage }}
      </p>
      <p v-if="currentUserError || !currentUser" class="mt-5 rounded-lg border border-red-200 bg-white p-4 text-sm text-red-700" role="alert">
        Unable to verify your account. User management actions are unavailable.
      </p>
      <p v-if="pending" class="mt-6" role="status">Loading users...</p>
      <div v-else-if="error" class="mt-6 rounded-lg border border-red-200 bg-white p-5" role="alert">
        <p>Unable to load users.</p>
        <button
          class="mt-3 rounded-lg bg-[#064784] px-4 py-2 text-sm font-medium text-white hover:bg-[#053765]"
          @click="refresh()"
        >
          Try again
        </button>
      </div>
      <p v-else-if="!users?.length" class="mt-6">No users found.</p>
      <div v-else class="mt-6 grid gap-4 sm:grid-cols-2">
        <article
          v-for="user in users"
          :key="user.id"
          class="rounded-lg border border-[#e1e6eb] bg-white p-5 shadow-sm"
        >
          <h2 class="text-lg font-semibold">{{ user.displayName || user.name }}</h2>
          <p v-if="user.displayName" class="mt-1 text-sm text-[#5b6570]">{{ user.name }}</p>
          <p class="mt-1 text-sm text-[#5b6570]">{{ user.email }}</p>
          <p class="mt-4 inline-flex rounded-full bg-[#eef4fa] px-3 py-1 text-xs font-medium capitalize">
            {{ user.role }}
          </p>
          <div class="mt-5 flex flex-wrap gap-2">
            <button
              v-if="currentUser && (user.id !== currentUser.id || user.role !== 'admin')"
              type="button"
              :disabled="pendingUserId !== null"
              class="rounded-lg border border-[#cfd5da] px-3 py-2 text-sm font-medium text-[#064784] hover:bg-[#f7f9fc] disabled:opacity-50"
              @click="changeRole(user)"
            >
              {{ pendingUserId === user.id
                ? "Updating..."
                : user.role === "admin" ? "Demote to student" : "Promote to admin" }}
            </button>
            <span
              v-else-if="currentUser && user.id === currentUser.id"
              class="self-center text-xs text-[#5b6570]"
              title="You cannot change your own administrator role."
            >
            </span>
            <button
              v-if="currentUser && user.id !== currentUser.id"
              type="button"
              :disabled="pendingUserId !== null"
              class="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              @click="removeUser(user)"
            >
              {{ pendingUserId === user.id ? "Deleting..." : "Delete user" }}
            </button>
            <span
              v-else-if="currentUser && user.id === currentUser.id"
              class="self-center text-xs text-[#5b6570]"
              title="You cannot delete your own account."
            >
            </span>
            <span v-if="!currentUser" class="self-center text-xs text-[#5b6570]">
              Actions unavailable
            </span>
          </div>
        </article>
      </div>
    </section>
  </main>
</template>
