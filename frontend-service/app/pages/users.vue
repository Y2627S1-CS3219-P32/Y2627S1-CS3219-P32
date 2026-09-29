<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-29.
Scope: Simple user card display and request states. Author review: Done. -->
<script setup lang="ts">
import UserCard from "../services/user-service/components/UserCard.vue";
import { useUsers } from "../services/user-service/composables/useUsers";

const { data: users, pending, error, refresh } = await useUsers();
</script>

<template>
  <main class="min-h-screen bg-[#f7f9fc] px-6 py-12 text-[#06427e] sm:px-12">
    <section class="mx-auto w-full max-w-4xl">
      <h1 class="text-3xl font-bold">Users</h1>

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
        <UserCard v-for="user in users" :key="user.id" :user="user" />
      </div>
    </section>
  </main>
</template>
