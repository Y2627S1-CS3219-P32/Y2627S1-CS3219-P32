<script setup lang="ts">
const props = defineProps<{ title: string; message: string; confirmLabel?: string }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const dialog = ref<HTMLDialogElement>();
const cancelButton = ref<HTMLButtonElement>();
let previousFocus: Element | null = null;
onMounted(() => {
  previousFocus = document.activeElement;
  dialog.value?.showModal();
  cancelButton.value?.focus();
});
onUnmounted(() => {
  if (previousFocus instanceof HTMLElement) previousFocus.focus();
});
</script>
<template>
  <dialog ref="dialog" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-message" class="m-auto w-[calc(100%_-_2rem)] max-w-md rounded-xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-slate-900/40" @cancel.prevent="emit('cancel')">
    <h2 id="delete-dialog-title" class="text-lg font-semibold">{{ props.title }}</h2>
    <p id="delete-dialog-message" class="mt-3 text-sm leading-6 text-slate-600">{{ props.message }}</p>
    <div class="mt-6 flex justify-end gap-3">
      <button ref="cancelButton" class="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50" @click="emit('cancel')">Cancel</button>
      <button class="rounded-lg bg-red-700 px-4 py-2 text-sm text-white hover:bg-red-800" @click="emit('confirm')">{{ props.confirmLabel ?? 'Delete' }}</button>
    </div>
  </dialog>
</template>
