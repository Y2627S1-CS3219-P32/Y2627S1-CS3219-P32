<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-09-29.
Scope: Administrator edit form for PUT /suppliers/:id. Author review: Done.
Claude Code (Opus 5.5), 2026-09-30. Scope: Active toggle; edits save in place. Author review: Pending.
Claude Code (Opus 5.5), 2026-10-01. Scope: Operating hours field. Author review: Pending. -->
<script setup lang="ts">
import type { Supplier, SupplierUpdate } from "#shared/services/supplier-service/types";
import OperatingHoursPicker from "./OperatingHoursPicker.vue";

const props = defineProps<{ supplier: Supplier | null; types: string[]; buildings: string[] }>();
const emit = defineEmits<{ close: []; saved: [supplier: Supplier]; unauthorized: [] }>();

const dialog = ref<HTMLDialogElement | null>(null);
// The form always sends hours, so saving replaces them with what is shown.
type SupplierEditForm = SupplierUpdate & Required<Pick<SupplierUpdate, "operatingHours">>;
const form = ref<SupplierEditForm>(emptyForm());
const saving = ref(false);
const errorMessage = ref("");
// Remounts the hours picker so each opening starts from that supplier's hours.
const openCount = ref(0);

function emptyForm(): SupplierEditForm {
  return { name: "", type: "", buildingName: "", floor: "", locationDescription: "", latitude: "", longitude: "", imageUrl: "", isActive: true, operatingHours: [] };
}

watch(() => props.supplier, (supplier) => {
  errorMessage.value = "";
  if (!supplier) {
    dialog.value?.close();
    return;
  }
  form.value = {
    name: supplier.name,
    type: supplier.type,
    buildingName: supplier.buildingName ?? "",
    floor: supplier.floor ?? "",
    locationDescription: supplier.locationDescription ?? "",
    latitude: supplier.latitude,
    longitude: supplier.longitude,
    imageUrl: supplier.imageUrl ?? "",
    isActive: supplier.isActive,
    operatingHours: supplier.operatingHours.map(period => ({ ...period })),
  };
  openCount.value++;
  nextTick(() => dialog.value?.showModal());
});

function statusOf(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
    ? error.statusCode
    : undefined;
}

function messageOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = error.data;
    if (typeof data === "object" && data !== null && "message" in data && typeof data.message === "string") return data.message;
  }
  return "The supplier could not be saved. Please try again.";
}

async function save() {
  if (!props.supplier) return;
  saving.value = true;
  errorMessage.value = "";
  try {
    const updated = await $fetch<Supplier>(`/api/supplier-service/suppliers/${encodeURIComponent(props.supplier.id)}`, {
      method: "PUT",
      body: form.value,
    });
    emit("saved", updated);
  } catch (error) {
    if (statusOf(error) === 401) emit("unauthorized");
    else errorMessage.value = messageOf(error);
  } finally {
    saving.value = false;
  }
}

const label = "mb-1 block text-xs font-medium text-[#5b6570]";
const input = "w-full rounded-lg border border-[#cfd5da] bg-white px-3 py-2 text-sm text-[#25313c] focus:border-[#064784] focus:outline-none focus:ring-2 focus:ring-[#064784]/20";
</script>

<template>
  <dialog
    ref="dialog"
    aria-labelledby="edit-supplier-title"
    class="m-auto max-h-[calc(100%-2rem)] w-[min(36rem,calc(100%-2rem))] overflow-y-auto rounded-lg bg-white p-0 text-[#25313c] shadow-xl backdrop:bg-black/40"
    @close="emit('close')"
  >
    <form class="p-5" @submit.prevent="save">
      <h2 id="edit-supplier-title" class="text-lg font-semibold">Edit supplier</h2>

      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <div class="sm:col-span-2">
          <label for="edit-name" :class="label">Name</label>
          <input id="edit-name" v-model="form.name" required maxlength="256" :class="input">
        </div>
        <div>
          <label for="edit-type" :class="label">Type</label>
          <input id="edit-type" v-model="form.type" required maxlength="256" list="edit-type-options" autocomplete="off" :class="input">
          <datalist id="edit-type-options">
            <option v-for="type in types" :key="type" :value="type" />
          </datalist>
        </div>
        <div>
          <label for="edit-building" :class="label">Building</label>
          <input id="edit-building" v-model="form.buildingName" maxlength="256" list="edit-building-options" autocomplete="off" :class="input">
          <datalist id="edit-building-options">
            <option v-for="building in buildings" :key="building" :value="building" />
          </datalist>
        </div>
        <div>
          <label for="edit-floor" :class="label">Floor</label>
          <input id="edit-floor" v-model="form.floor" maxlength="256" :class="input">
        </div>
        <div>
          <label for="edit-description" :class="label">Location description</label>
          <input id="edit-description" v-model="form.locationDescription" maxlength="256" :class="input">
        </div>
        <div>
          <label for="edit-latitude" :class="label">Latitude</label>
          <input id="edit-latitude" v-model="form.latitude" required inputmode="decimal" :class="input">
        </div>
        <div>
          <label for="edit-longitude" :class="label">Longitude</label>
          <input id="edit-longitude" v-model="form.longitude" required inputmode="decimal" :class="input">
        </div>
        <div class="sm:col-span-2">
          <label for="edit-image" :class="label">Image URL</label>
          <input id="edit-image" v-model="form.imageUrl" type="url" :class="input">
        </div>
        <div class="sm:col-span-2">
          <label for="edit-active" class="flex items-center gap-2 text-sm text-[#25313c]">
            <input id="edit-active" v-model="form.isActive" type="checkbox" class="size-4 accent-[#064784]">
            Active <span class="text-xs text-[#5b6570]">(inactive suppliers are hidden from students)</span>
          </label>
        </div>
        <OperatingHoursPicker :key="openCount" v-model="form.operatingHours" id-prefix="edit" preselect class="sm:col-span-2" />
      </div>

      <p v-if="errorMessage" class="mt-4 text-sm text-red-700" role="alert">{{ errorMessage }}</p>

      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class="rounded-lg px-4 py-2 text-sm font-medium text-[#5b6570] hover:bg-[#f7f9fc]" @click="dialog?.close()">Cancel</button>
        <button type="submit" class="rounded-lg bg-[#064784] px-4 py-2 text-sm font-medium text-white hover:bg-[#053765]" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
      </div>
    </form>
  </dialog>
</template>
