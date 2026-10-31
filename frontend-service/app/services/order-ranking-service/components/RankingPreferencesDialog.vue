<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
Scope: Dialog for the courier's ranking preferences (supplier types, buildings, minimum
reward and a free-text note), following SupplierReferenceDialog. Author review: Pending. -->
<script setup lang="ts">
import type { RankingPreferences } from "#shared/services/order-ranking-service/types";
import type { SupplierReference } from "#shared/services/supplier-service/types";
import { statusOf } from "../../order-service/composables/useOrders";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const dialog = ref<HTMLDialogElement | null>(null);
const types = ref<SupplierReference[]>([]);
const buildings = ref<SupplierReference[]>([]);
const form = reactive({ supplierTypes: [] as string[], buildings: [] as string[], minReward: "", note: "" });
const loading = ref(false);
const busy = ref(false);
const errorMessage = ref("");
const route = useRoute();

async function fail(error: unknown, fallback: string) {
  if (statusOf(error) === 401) await navigateTo({ path: "/login", query: { redirect: route.fullPath } });
  else errorMessage.value = getApiErrorMessage(error) ?? fallback;
}

async function load() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const [prefs, typeList, buildingList] = await Promise.all([
      $fetch<RankingPreferences>("/api/order-ranking-service/preferences"),
      $fetch<SupplierReference[]>("/api/supplier-service/types"),
      $fetch<SupplierReference[]>("/api/supplier-service/buildings"),
    ]);
    types.value = typeList;
    buildings.value = buildingList;
    form.supplierTypes = prefs.supplierTypes;
    form.buildings = prefs.buildings;
    form.minReward = prefs.minReward === null ? "" : String(prefs.minReward);
    form.note = prefs.note ?? "";
  } catch (error) {
    await fail(error, "Your preferences could not be loaded.");
  } finally {
    loading.value = false;
  }
}

watch(() => props.open, (open) => {
  if (open) {
    dialog.value?.showModal();
    void load();
  } else {
    dialog.value?.close();
  }
});

async function save() {
  busy.value = true;
  errorMessage.value = "";
  try {
    await $fetch("/api/order-ranking-service/preferences", {
      method: "PUT",
      body: {
        supplierTypes: form.supplierTypes,
        buildings: form.buildings,
        minReward: form.minReward === "" ? null : Number(form.minReward),
        note: form.note.trim() || null,
      },
    });
    emit("saved");
    dialog.value?.close();
  } catch (error) {
    await fail(error, "Your preferences could not be saved.");
  } finally {
    busy.value = false;
  }
}

const chip = "cursor-pointer rounded-full border px-3 py-1 text-sm has-checked:border-[#e6873a] has-checked:bg-[#e6873a] has-checked:text-white";
const input = "w-full rounded-lg border border-[#d3d7db] px-3 py-2 text-sm";
</script>

<template>
  <dialog
    ref="dialog"
    aria-labelledby="ranking-preferences-title"
    class="m-auto w-[min(32rem,calc(100%-2rem))] rounded-lg bg-white p-0 text-[#25313c] shadow-xl backdrop:bg-black/40"
    @close="emit('close')"
  >
    <form class="p-5" @submit.prevent="save">
      <h2 id="ranking-preferences-title" class="text-lg font-semibold">What you like to deliver</h2>
      <p class="mt-1 text-xs text-[#5b6570]">Used to rank the For You tab. Everything is optional; orders you deliver also count.</p>

      <p v-if="loading" class="mt-4 text-sm text-[#5b6570]">Loading…</p>
      <template v-else>
        <fieldset class="mt-4">
          <legend class="text-sm font-medium">Supplier types</legend>
          <div class="mt-2 flex flex-wrap gap-2">
            <label v-for="type in types" :key="type.id" :class="chip">
              <input v-model="form.supplierTypes" type="checkbox" :value="type.name" class="sr-only">{{ type.name }}
            </label>
          </div>
        </fieldset>

        <fieldset class="mt-4">
          <legend class="text-sm font-medium">Buildings you pick up from</legend>
          <div class="mt-2 flex flex-wrap gap-2">
            <label v-for="building in buildings" :key="building.id" :class="chip">
              <input v-model="form.buildings" type="checkbox" :value="building.name" class="sr-only">{{ building.name }}
            </label>
          </div>
        </fieldset>

        <label class="mt-4 block text-sm font-medium" for="ranking-min-reward">Minimum reward (credits)</label>
        <input id="ranking-min-reward" v-model="form.minReward" type="number" min="1" step="1" placeholder="Any" :class="[input, 'mt-1 max-w-32']">

        <label class="mt-4 block text-sm font-medium" for="ranking-note">In your own words</label>
        <textarea id="ranking-note" v-model="form.note" maxlength="500" rows="3" placeholder="e.g. coffee and bubble tea runs near UTown" :class="[input, 'mt-1']" />
      </template>

      <p v-if="errorMessage" class="mt-3 text-sm text-red-700" role="alert">{{ errorMessage }}</p>

      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class="rounded-lg px-4 py-2 text-sm font-medium text-[#5b6570] hover:bg-[#f7f9fc]" @click="dialog?.close()">Cancel</button>
        <button type="submit" :disabled="busy || loading" class="rounded-lg bg-[#173a73] px-4 py-2 text-sm font-medium text-white hover:bg-[#10305f] disabled:opacity-60">Save</button>
      </div>
    </form>
  </dialog>
</template>
