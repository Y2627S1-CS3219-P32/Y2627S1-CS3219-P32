<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28; Claude Code (Opus 5.5), 2026-09-29.
Scope: Supplier card using the existing API fields; Tailwind styling after the supplier mockup. Author review: Done.
Claude Code (Opus 5.5), 2026-09-29. Scope: Administrator actions menu. Author review: Done. -->
<script setup lang="ts">
import type { Supplier } from "#shared/services/supplier-service/types";

const props = defineProps<{ supplier: Supplier; canManage?: boolean }>();
const emit = defineEmits<{ edit: [supplier: Supplier]; delete: [supplier: Supplier] }>();
const imageFailed = ref(false);

const menuOpen = ref(false);
const menuRoot = ref<HTMLElement | null>(null);
const menuButton = ref<HTMLButtonElement | null>(null);

function closeMenu(restoreFocus = false) {
  menuOpen.value = false;
  if (restoreFocus) menuButton.value?.focus();
}

function choose(action: "edit" | "delete") {
  closeMenu();
  if (action === "edit") emit("edit", props.supplier);
  else emit("delete", props.supplier);
}

function onDocumentClick(event: MouseEvent) {
  if (menuOpen.value && !menuRoot.value?.contains(event.target as Node)) closeMenu();
}
onMounted(() => document.addEventListener("click", onDocumentClick));
onBeforeUnmount(() => document.removeEventListener("click", onDocumentClick));
const localImages = new Set(["ANNA.jpeg", "NUS_COOP.jpeg", "PRINTER_COM2.jpeg", "COOL_SPOT.jpeg", "INSTACHEF.jpeg", "ROBOT_CAFE.jpeg"]);
const imageSource = computed(() => {
  if (!props.supplier.imageUrl) return null;
  try {
    const url = new URL(props.supplier.imageUrl);
    const filename = url.pathname.split("/").pop() ?? "";
    if (url.hostname === "github.com" && localImages.has(filename)) return `/images/suppliers/${filename}`;
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
});
const initials = computed(() => props.supplier.name.split(/\s+/).slice(0, 2).map(word => word[0]).join(""));
const location = computed(() => {
  const place = [props.supplier.buildingName, props.supplier.floor ? `Level ${props.supplier.floor}` : null].filter(Boolean).join(" · ");
  const description = props.supplier.locationDescription;
  if (place && description) return `${place} (${description})`;
  return place || description || "Location details unavailable";
});
const status = computed(() => {
  if (!props.supplier.isActive) return { label: "Inactive", class: "bg-[#e04444] text-white" };
  return props.supplier.isOpen
    ? { label: "Open now", class: "bg-[#3aa76d] text-white" }
    : { label: "Closed now", class: "bg-[#8a9099] text-white" };
});
const mapUrl = computed(() => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${props.supplier.latitude},${props.supplier.longitude}`)}`);
</script>

<template>
  <article class="group relative flex items-start gap-4 rounded-md bg-white p-3.5 shadow-[0_2px_6px_rgba(0,0,0,0.14)]" :class="{ 'opacity-60': !supplier.isActive }">
    <div v-if="canManage && supplier.isActive" ref="menuRoot" class="absolute top-1.5 right-1.5 z-10" @keydown.esc="closeMenu(true)">
      <button
        ref="menuButton"
        type="button"
        class="flex h-7 w-9 items-center justify-center rounded-full bg-white/90 text-lg leading-none text-[#33383d] shadow-sm transition-opacity hover:bg-[#eef4fa] [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100"
        :class="{ 'opacity-100!': menuOpen }"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        :aria-label="`Actions for ${supplier.name}`"
        @click="menuOpen = !menuOpen"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      <div v-if="menuOpen" role="menu" class="absolute right-0 mt-1 w-32 overflow-hidden rounded-md border border-[#e1e6eb] bg-white py-1 text-sm shadow-lg">
        <button type="button" role="menuitem" class="block w-full px-3 py-2 text-left text-[#25313c] hover:bg-[#f7f9fc]" @click="choose('edit')">Edit</button>
        <button type="button" role="menuitem" class="block w-full px-3 py-2 text-left text-[#c62828] hover:bg-[#fdf2f2]" @click="choose('delete')">Delete</button>
      </div>
    </div>
    <div class="min-w-0 flex-1">
      <h2 class="text-[15px] font-semibold text-[#4a4f55] wrap-anywhere">{{ supplier.name }}</h2>
      <div class="mt-1.5 flex flex-wrap gap-1">
        <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold" :class="status.class">{{ status.label }}</span>
        <span class="rounded-full bg-[#d3d7db] px-2 py-0.5 text-[11px] font-semibold text-[#33383d]">{{ supplier.type }}</span>
      </div>
      <a
        :href="mapUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="mt-2 flex items-start gap-1 text-[13px] text-[#5b6570] hover:text-[#064784] hover:underline"
        :aria-label="`${location}. View ${supplier.name} on Google Maps (opens in a new tab)`"
      >
        <svg class="mt-0.5 size-3.5 shrink-0 text-[#8a9099]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>
        <span>{{ location }}</span>
      </a>
    </div>
    <div class="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#e6ecf2] text-lg font-semibold text-[#064784]">
      <img v-if="imageSource && !imageFailed" :src="imageSource" alt="" loading="lazy" width="64" height="64" class="size-full object-cover" @error="imageFailed = true">
      <span v-else aria-hidden="true">{{ initials }}</span>
    </div>
  </article>
</template>
