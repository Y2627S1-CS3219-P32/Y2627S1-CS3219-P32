<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
Scope: Supplier card using the existing API fields. Author review: pending. -->
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
const location = computed(() => [props.supplier.buildingName, props.supplier.floor ? `Level ${props.supplier.floor}` : null].filter(Boolean).join(" · "));
const mapUrl = computed(() => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${props.supplier.latitude},${props.supplier.longitude}`)}`);
</script>

<template>
  <article class="supplier-card" :class="{ 'is-closed': !supplier.isOpen }">
    <div class="card-topline">
      <div class="supplier-avatar" :data-category="supplier.type">
        <img v-if="imageSource && !imageFailed" :src="imageSource" alt="" loading="lazy" width="60" height="60" @error="imageFailed = true">
        <span v-else aria-hidden="true">{{ initials }}</span>
      </div>
      <span class="status-pill" :class="supplier.isOpen ? 'open' : 'closed'">
        <span class="status-dot" />
        {{ !supplier.isActive ? 'Inactive' : supplier.isOpen ? 'Open now' : 'Closed now' }}
      </span>
    </div>
    <h3>{{ supplier.name }}</h3>
    <p class="card-location">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>
      <span>{{ location || 'Location details unavailable' }}</span>
    </p>
    <p class="card-description">{{ supplier.locationDescription || 'Find this supplier on the campus map.' }}</p>
    <div class="card-bottomline">
      <span class="type-label">{{ supplier.type }}</span>
      <a :href="mapUrl" target="_blank" rel="noopener noreferrer" class="map-link" :aria-label="`View ${supplier.name} on Google Maps (opens in a new tab)`">
        View location <span aria-hidden="true">↗</span>
      </a>
    </div>
  </article>
</template>
