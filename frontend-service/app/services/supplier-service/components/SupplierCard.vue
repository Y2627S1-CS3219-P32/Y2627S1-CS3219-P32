<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28; Claude Code (Opus 5.5), 2026-09-29.
Scope: Supplier card using the existing API fields; Tailwind styling. Author review: Done. -->
<script setup lang="ts">
import type { Supplier } from "#shared/services/supplier-service/types";

const props = defineProps<{ supplier: Supplier }>();
const imageFailed = ref(false);
const localImages = new Set(["ANNA.jpeg", "NUS_COOP.jpeg", "PRINTER_COM2.jpeg", "COOL_SPOT.jpeg", "INSTACHEF.jpeg", "ROBOT_CAFE.jpeg"]);
const avatarColors: Record<string, string> = {
  "Food/Coffee": "bg-[#ece3db] text-[#876b50]",
  Shopping: "bg-[#e6e8f1] text-[#757b9a]",
  Printing: "bg-[#e4ece8] text-[#598474]",
};
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
const location = computed(() => [props.supplier.buildingName, props.supplier.floor ? `Level ${props.supplier.floor}` : null].filter(Boolean).join(" · "));
const mapUrl = computed(() => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${props.supplier.latitude},${props.supplier.longitude}`)}`);
</script>

<template>
  <article class="flex min-w-0 flex-col rounded-xl border border-[#dde3d9] bg-white p-[23px] transition-[border-color,box-shadow] duration-[160ms] hover:border-[#b4c7ac] hover:shadow-[0_6px_22px_#234f2b0a] min-[480px]:max-[700px]:p-[17px] min-[1500px]:p-[26px]">
    <div class="mb-5 flex items-start justify-between gap-3">
      <div
        class="flex size-[58px] shrink-0 items-center justify-center overflow-hidden rounded-xl text-[19px] font-medium tracking-[-0.5px] min-[480px]:max-[700px]:size-[47px]"
        :class="avatarColors[supplier.type] ?? 'bg-[#f0e7d7] text-[#957950]'"
      >
        <img v-if="imageSource && !imageFailed" :src="imageSource" alt="" loading="lazy" width="60" height="60" class="size-full object-cover" @error="imageFailed = true">
        <span v-else aria-hidden="true">{{ initials }}</span>
      </div>
      <span
        class="mt-px flex items-center gap-[5px] rounded-[20px] px-[9px] py-1.5 text-[10px] font-semibold whitespace-nowrap min-[480px]:max-[700px]:px-[7px] min-[480px]:max-[700px]:py-[5px] min-[480px]:max-[700px]:text-[9px]"
        :class="supplier.isOpen ? 'bg-[#edf5e9] text-[#4b8055]' : 'bg-[#f2f1ec] text-[#878578]'"
      >
        <span class="size-[5px] rounded-full bg-current" />
        {{ !supplier.isActive ? 'Inactive' : supplier.isOpen ? 'Open now' : 'Closed now' }}
      </span>
    </div>
    <h3 class="mb-3 text-[19px] leading-[1.4] font-semibold tracking-[-0.35px] wrap-anywhere min-[480px]:text-[16px] min-[700px]:text-[18px]">{{ supplier.name }}</h3>
    <p class="mb-[7px] flex items-start gap-1.5 text-[11px] leading-[1.55] text-[#586958]">
      <svg class="mt-px size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>
      <span>{{ location || 'Location details unavailable' }}</span>
    </p>
    <p class="mb-[22px] pl-5 text-[11px] leading-[1.6] text-[#8a9287] min-[480px]:min-h-[35px]">{{ supplier.locationDescription || 'Find this supplier on the campus map.' }}</p>
    <div class="mt-auto flex items-center justify-between gap-2.5 border-t border-[#eef0e9] pt-[15px] min-[480px]:max-[700px]:flex-wrap min-[480px]:max-[700px]:items-start min-[480px]:max-[700px]:gap-3">
      <span class="rounded-[5px] bg-[#f5f6f0] px-2 py-[5px] text-[10px] text-[#7a846f]">{{ supplier.type }}</span>
      <a :href="mapUrl" target="_blank" rel="noopener noreferrer" class="flex items-center gap-[9px] text-[11px] font-medium whitespace-nowrap text-[#56715a] no-underline hover:underline" :aria-label="`View ${supplier.name} on Google Maps (opens in a new tab)`">
        View location <span class="text-[15px]" aria-hidden="true">↗</span>
      </a>
    </div>
  </article>
</template>
