<script setup lang="ts">
import type { Conversation, Page } from '#shared/services/agent-service/types';
defineProps<{
  page: Page<Conversation>;
  selected: string | null;
  busy: boolean;
}>();
const emit = defineEmits<{
  select: [id: string];
  newChat: [];
  delete: [chat: Conversation];
  more: [];
}>();
</script>
<template>
  <div class="space-y-4">
    <button
      class="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium"
      :disabled="busy"
      @click="emit('newChat')"
    >
      <svg
        aria-hidden="true"
        class="mr-2 inline h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5M13.5 6.5l4-4a2.1 2.1 0 0 1 3 3l-9 9-4 1 1-4 5-5Z" />
      </svg>
      New chat
    </button>
    <ul class="space-y-1">
      <li
        v-for="chat in page.items"
        :key="chat.id"
        :class="[
          'group flex items-center rounded-lg',
          selected === chat.id ? 'bg-slate-200' : 'hover:bg-slate-100',
        ]"
      >
        <button
          class="min-w-0 flex-1 truncate px-3 py-3 text-left text-sm"
          :title="chat.title"
          :disabled="busy"
          @click="emit('select', chat.id)"
        >
          {{ chat.title }}
        </button>
        <button
          :aria-label="`Delete ${chat.title}`"
          title="Delete chat"
          :disabled="busy"
          class="chat-delete mr-1 shrink-0 rounded-lg p-2 text-slate-500 transition-opacity hover:bg-red-50 hover:text-red-700 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
          @click="emit('delete', chat)"
        >
          <svg
            aria-hidden="true"
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
          </svg>
        </button>
      </li>
    </ul>
    <button
      v-if="page.next_cursor"
      class="text-sm text-slate-500 hover:underline"
      :disabled="busy"
      @click="emit('more')"
    >
      Show more
    </button>
  </div>
</template>
<style scoped>
@media (hover: none) {
  .chat-delete {
    opacity: 1;
  }
}
</style>
