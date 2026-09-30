<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-09-30.
Scope: Administrator form for POST /suppliers, with type/building dropdowns and browser geolocation. Author review: Done.
AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-09-30.
Scope: Operating hours field. Author review: Pending. -->
<script setup lang="ts">
import type { Supplier, SupplierCreate, SupplierReference } from "#shared/services/supplier-service/types";
import OperatingHoursPicker from "./OperatingHoursPicker.vue";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; created: [supplier: Supplier]; unauthorized: [] }>();

const dialog = ref<HTMLDialogElement | null>(null);
const form = ref<SupplierCreate>(emptyForm());
const types = ref<SupplierReference[]>([]);
const buildings = ref<SupplierReference[]>([]);
const optionsError = ref("");
const saving = ref(false);
const errorMessage = ref("");
const locating = ref(false);
const locationMessage = ref("");
// Remounts the hours picker so each opening starts with no selection.
const openCount = ref(0);

function emptyForm(): SupplierCreate {
  return { name: "", type: "", buildingName: null, floor: "", locationDescription: "", latitude: "", longitude: "", imageUrl: "", operatingHours: [] };
}

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
  return "The supplier could not be created. Please try again.";
}

// Lists are reloaded each time the dialog opens, so new types and buildings appear.
async function loadOptions() {
  optionsError.value = "";
  try {
    [types.value, buildings.value] = await Promise.all([
      $fetch<SupplierReference[]>("/api/supplier-service/types"),
      $fetch<SupplierReference[]>("/api/supplier-service/buildings"),
    ]);
  } catch (error) {
    if (statusOf(error) === 401) emit("unauthorized");
    else optionsError.value = "Supplier types and buildings could not be loaded.";
  }
}

watch(() => props.open, (open) => {
  if (!open) {
    dialog.value?.close();
    return;
  }
  form.value = emptyForm();
  errorMessage.value = "";
  locationMessage.value = "";
  openCount.value++;
  loadOptions();
  nextTick(() => dialog.value?.showModal());
});

// Simplified: uses the admin's current position as the supplier's location.
function useCurrentLocation() {
  if (!("geolocation" in navigator)) {
    locationMessage.value = "This browser does not support location access. Enter the coordinates instead.";
    return;
  }
  locating.value = true;
  locationMessage.value = "";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      form.value.latitude = position.coords.latitude.toFixed(6);
      form.value.longitude = position.coords.longitude.toFixed(6);
      locationMessage.value = `Location set (accurate to about ${Math.round(position.coords.accuracy)} m).`;
      locating.value = false;
    },
    (error) => {
      locationMessage.value = error.code === error.PERMISSION_DENIED
        ? "Location access was denied. Allow it in the browser, or enter the coordinates instead."
        : "Your location could not be found. Try again, or enter the coordinates instead.";
      locating.value = false;
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

async function save() {
  saving.value = true;
  errorMessage.value = "";
  try {
    const created = await $fetch<Supplier>("/api/supplier-service/suppliers", { method: "POST", body: form.value });
    emit("created", created);
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
    aria-labelledby="create-supplier-title"
    class="m-auto max-h-[calc(100%-2rem)] w-[min(36rem,calc(100%-2rem))] overflow-y-auto rounded-lg bg-white p-0 text-[#25313c] shadow-xl backdrop:bg-black/40"
    @close="emit('close')"
  >
    <form class="p-5" @submit.prevent="save">
      <h2 id="create-supplier-title" class="text-lg font-semibold">Add supplier</h2>
      <p class="mt-1 text-xs text-[#5b6570]">New suppliers are active straight away. They show as open during their operating hours.</p>
      <p v-if="optionsError" class="mt-3 text-sm text-red-700" role="alert">{{ optionsError }}</p>

      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <div class="sm:col-span-2">
          <label for="create-name" :class="label">Name</label>
          <input id="create-name" v-model="form.name" required maxlength="256" :class="input">
        </div>
        <div>
          <label for="create-type" :class="label">Type</label>
          <select id="create-type" v-model="form.type" required :class="input">
            <option value="" disabled>Select a type</option>
            <option v-for="type in types" :key="type.id" :value="type.name">{{ type.name }}</option>
          </select>
        </div>
        <div>
          <label for="create-building" :class="label">Building</label>
          <select id="create-building" v-model="form.buildingName" :class="input">
            <option :value="null">No building</option>
            <option v-for="building in buildings" :key="building.id" :value="building.name">{{ building.name }}</option>
          </select>
        </div>
        <div class="sm:col-span-2">
          <label for="create-floor" :class="label">Floor</label>
          <input id="create-floor" v-model="form.floor" maxlength="256" :class="input">
        </div>
        <div class="sm:col-span-2">
          <label for="create-description" :class="label">Location description</label>
          <textarea id="create-description" v-model="form.locationDescription" maxlength="256" rows="3" :class="[input, 'resize-y']" />
        </div>
        <div class="sm:col-span-2">
          <div class="mb-1 flex items-center justify-between gap-3">
            <span class="text-xs font-medium text-[#5b6570]">Location</span>
            <button type="button" class="text-xs font-medium text-[#064784] hover:underline disabled:opacity-60" :disabled="locating" @click="useCurrentLocation">
              {{ locating ? 'Locating…' : 'Use my location' }}
            </button>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="create-latitude" class="sr-only">Latitude</label>
              <input id="create-latitude" v-model="form.latitude" required inputmode="decimal" placeholder="Latitude" :class="input">
            </div>
            <div>
              <label for="create-longitude" class="sr-only">Longitude</label>
              <input id="create-longitude" v-model="form.longitude" required inputmode="decimal" placeholder="Longitude" :class="input">
            </div>
          </div>
          <p v-if="locationMessage" class="mt-1 text-xs text-[#5b6570]" role="status">{{ locationMessage }}</p>
        </div>
        <div class="sm:col-span-2">
          <label for="create-image" :class="label">Image URL</label>
          <input id="create-image" v-model="form.imageUrl" type="url" :class="input">
        </div>
        <OperatingHoursPicker :key="openCount" v-model="form.operatingHours" class="sm:col-span-2" />
      </div>

      <p v-if="errorMessage" class="mt-4 text-sm text-red-700" role="alert">{{ errorMessage }}</p>

      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class="rounded-lg px-4 py-2 text-sm font-medium text-[#5b6570] hover:bg-[#f7f9fc]" @click="dialog?.close()">Cancel</button>
        <button type="submit" class="rounded-lg bg-[#064784] px-4 py-2 text-sm font-medium text-white hover:bg-[#053765]" :disabled="saving">{{ saving ? 'Adding…' : 'Add supplier' }}</button>
      </div>
    </form>
  </dialog>
</template>
