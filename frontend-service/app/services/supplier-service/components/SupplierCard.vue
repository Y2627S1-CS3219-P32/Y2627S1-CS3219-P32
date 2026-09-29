<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28; Claude Code (Opus 5.5), 2026-09-29.
Scope: Supplier card using the existing API fields; Tailwind styling after the supplier mockup. Author review: Done. -->
<script setup lang="ts">
import type { Supplier } from "#shared/services/supplier-service/types";

const props = defineProps<{ supplier: Supplier }>();
const imageFailed = ref(false);
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
  <article class="flex items-start gap-4 rounded-md bg-white p-3.5 shadow-[0_2px_6px_rgba(0,0,0,0.14)]">
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
