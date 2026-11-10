<script setup lang="ts">
defineProps<{ message: string }>();
const emit = defineEmits<{ dismiss: [] }>();
</script>
<template>
  <Teleport to="body">
    <div class="pointer-events-none fixed inset-x-3 top-3 z-[60] flex flex-col items-stretch gap-2 md:inset-x-auto md:top-20 md:right-6 md:w-96" aria-live="polite">
      <div v-if="message" role="status" class="pointer-events-auto flex items-start gap-3 rounded-lg border border-[#e1e6eb] bg-white p-3 shadow-lg">
        <p class="min-w-0 flex-1 text-left text-sm text-[#25313c]">{{ message }}</p>
        <button type="button" class="shrink-0 text-lg leading-none text-[#8a9099] hover:text-[#25313c]" aria-label="Dismiss notification" @click="emit('dismiss')">×</button>
      </div>
    </div>
  </Teleport>
</template>
