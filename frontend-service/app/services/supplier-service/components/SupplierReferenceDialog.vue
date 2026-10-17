<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-15.
Scope: Administrator dialog to add, rename, and delete supplier types or buildings. Author review: Pending. -->
<script setup lang="ts">
import type { SupplierReference, SupplierReferenceKind } from "#shared/services/supplier-service/types";
import { getApiErrorMessage } from "../../../utils/get-api-error-message";

// The dialog is open while `kind` is set.
const props = defineProps<{ kind: SupplierReferenceKind | null }>();
const emit = defineEmits<{ close: []; changed: []; unauthorized: [] }>();

const dialog = ref<HTMLDialogElement | null>(null);
const items = ref<SupplierReference[]>([]);
const loading = ref(false);
const busy = ref(false);
const errorMessage = ref("");
const newName = ref("");
const editingId = ref<string | null>(null);
const editingName = ref("");

const noun = computed(() => props.kind === "types" ? "type" : "building");
const title = computed(() => props.kind === "types" ? "Supplier types" : "Buildings");
const endpoint = computed(() => `/api/supplier-service/${props.kind}`);

function statusOf(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
    ? error.statusCode
    : undefined;
}

function fail(error: unknown, fallback: string) {
  if (statusOf(error) === 401) emit("unauthorized");
  else errorMessage.value = getApiErrorMessage(error) ?? fallback;
}

async function load() {
  loading.value = true;
  try {
    items.value = await $fetch<SupplierReference[]>(endpoint.value);
  } catch (error) {
    fail(error, `The ${noun.value}s could not be loaded.`);
  } finally {
    loading.value = false;
  }
}

watch(() => props.kind, (kind) => {
  if (!kind) {
    dialog.value?.close();
    return;
  }
  items.value = [];
  newName.value = "";
  editingId.value = null;
  errorMessage.value = "";
  load();
  nextTick(() => dialog.value?.showModal());
});

// Each change reloads the list so it matches the database order.
async function run(action: () => Promise<unknown>, fallback: string): Promise<boolean> {
  busy.value = true;
  errorMessage.value = "";
  try {
    await action();
    emit("changed");
    await load();
    return true;
  } catch (error) {
    fail(error, fallback);
    return false;
  } finally {
    busy.value = false;
  }
}

async function add() {
  const name = newName.value;
  if (await run(() => $fetch(endpoint.value, { method: "POST", body: { name } }), `The ${noun.value} could not be added.`)) {
    newName.value = "";
  }
}

function startEditing(item: SupplierReference) {
  editingId.value = item.id;
  editingName.value = item.name;
  errorMessage.value = "";
}

async function rename(item: SupplierReference) {
  const name = editingName.value;
  if (name.trim() === item.name) {
    editingId.value = null;
    return;
  }
  const url = `${endpoint.value}/${encodeURIComponent(item.id)}`;
  if (await run(() => $fetch(url, { method: "PUT", body: { name } }), `The ${noun.value} could not be renamed.`)) {
    editingId.value = null;
  }
}

async function remove(item: SupplierReference) {
  if (!window.confirm(`Delete the ${noun.value} "${item.name}"?`)) return;
  const url = `${endpoint.value}/${encodeURIComponent(item.id)}`;
  await run(() => $fetch(url, { method: "DELETE" }), `The ${noun.value} could not be deleted.`);
}

const input = "w-full rounded-lg border border-[#cfd5da] bg-white px-3 py-2 text-sm text-[#25313c] focus:border-[#064784] focus:outline-none focus:ring-2 focus:ring-[#064784]/20";
const primary = "shrink-0 rounded-lg bg-[#064784] px-4 py-2 text-sm font-medium text-white hover:bg-[#053765] disabled:opacity-60";
const link = "text-xs font-medium text-[#064784] hover:underline disabled:opacity-60";
</script>

<template>
  <dialog
    ref="dialog"
    aria-labelledby="supplier-reference-title"
    class="m-auto w-[min(28rem,calc(100%-2rem))] rounded-lg bg-white p-0 text-[#25313c] shadow-xl backdrop:bg-black/40"
    @close="emit('close')"
  >
    <div class="p-5">
      <h2 id="supplier-reference-title" class="text-lg font-semibold">{{ title }}</h2>
      <p class="mt-1 text-xs text-[#5b6570]">
        Renaming a {{ noun }} updates every supplier that uses it. A {{ noun }} still used by a supplier cannot be deleted.
      </p>

      <form class="mt-4 flex gap-2" @submit.prevent="add">
        <label for="supplier-reference-new" class="sr-only">New {{ noun }} name</label>
        <input id="supplier-reference-new" v-model="newName" required maxlength="256" :placeholder="`New ${noun} name`" :class="input">
        <button type="submit" :class="primary" :disabled="busy">Add</button>
      </form>

      <p v-if="errorMessage" class="mt-3 text-sm text-red-700" role="alert">{{ errorMessage }}</p>

      <ul class="mt-4 max-h-72 divide-y divide-[#e4e8eb] overflow-y-auto rounded-lg border border-[#e4e8eb]" :aria-busy="loading">
        <li v-for="item in items" :key="item.id" class="px-3 py-2">
          <form v-if="editingId === item.id" class="flex items-center gap-2" @submit.prevent="rename(item)">
            <label :for="`supplier-reference-${item.id}`" class="sr-only">Rename {{ item.name }}</label>
            <input :id="`supplier-reference-${item.id}`" v-model="editingName" required maxlength="256" :class="input">
            <button type="submit" :class="link" :disabled="busy">Save</button>
            <button type="button" class="text-xs font-medium text-[#5b6570] hover:underline" @click="editingId = null">Cancel</button>
          </form>
          <div v-else class="flex items-center justify-between gap-3">
            <span class="text-sm">{{ item.name }}</span>
            <div class="flex shrink-0 gap-3">
              <button type="button" :class="link" :disabled="busy" @click="startEditing(item)">Rename</button>
              <button type="button" class="text-xs font-medium text-red-700 hover:underline disabled:opacity-60" :disabled="busy" @click="remove(item)">Delete</button>
            </div>
          </div>
        </li>
        <li v-if="!loading && items.length === 0" class="px-3 py-4 text-center text-sm text-[#5b6570]">No {{ noun }}s yet.</li>
        <li v-if="loading && items.length === 0" class="px-3 py-4 text-center text-sm text-[#5b6570]">Loading…</li>
      </ul>

      <div class="mt-5 flex justify-end">
        <button type="button" class="rounded-lg px-4 py-2 text-sm font-medium text-[#5b6570] hover:bg-[#f7f9fc]" @click="dialog?.close()">Done</button>
      </div>
    </div>
  </dialog>
</template>
