<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
Scope: Order history grouped by day, newest first, after the student's mockups. Author review: Pending. -->
<script setup lang="ts">
import type { OrderEvent } from "#shared/services/order-service/types";
import { formatDay, formatStamp, historyText } from "../order-view";

const props = defineProps<{ events: OrderEvent[] }>();

const days = computed(() => {
  const groups: { day: string; events: OrderEvent[] }[] = [];
  for (const event of [...props.events].sort((a, b) => b.sequence - a.sequence)) {
    const day = formatDay(event.createdAt);
    const group = groups.at(-1);
    if (group?.day === day) group.events.push(event);
    else groups.push({ day, events: [event] });
  }
  return groups;
});
</script>

<template>
  <ol class="space-y-5">
    <li v-for="group in days" :key="group.day">
      <h3 class="mb-2 text-xl text-[#111]">{{ group.day }}</h3>
      <ol class="space-y-2.5">
        <li
          v-for="event in group.events"
          :key="event.id"
          class="rounded-md bg-white px-3 py-2.5 text-[15px] text-[#5b6570] shadow-[0_2px_6px_rgba(0,0,0,0.14)]"
        >
          [{{ formatStamp(event.createdAt) }}] {{ historyText(event).text }}
          <strong v-if="historyText(event).actor" class="font-semibold text-[#4a4f55]">{{ historyText(event).actor }}</strong>
        </li>
      </ol>
    </li>
  </ol>
</template>
