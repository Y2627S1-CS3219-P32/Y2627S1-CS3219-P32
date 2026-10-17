<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
Scope: Group order panel: the shareable join link (for the requester), who is in the group,
and joining for people who are not in it yet. Author review: Pending. -->
<script setup lang="ts">
import type { Order } from "#shared/services/order-service/types";
import { isMember, personName } from "../order-view";

const props = defineProps<{ order: Order; viewerId: number | undefined; busy?: boolean }>();
const emit = defineEmits<{ join: [] }>();

const link = computed(() => `${useRequestURL().origin}/orders/${props.order.id}/join`);
const copied = ref(false);
async function copy() {
  try {
    await navigator.clipboard.writeText(link.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    copied.value = false;
  }
}
const people = computed(() => [props.order.requester, ...props.order.members]);
</script>

<template>
  <section class="mt-6 rounded-md bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.14)]" aria-labelledby="group-heading">
    <h2 id="group-heading" class="font-semibold text-[#111]">Group</h2>
    <ul class="mt-2 space-y-1 text-[15px] text-[#5b6570]">
      <li v-for="(person, index) in people" :key="person.id">
        {{ personName(person) }}<span v-if="index === 0" class="text-[#8a9099]"> (requester)</span><span v-if="person.id === viewerId" class="text-[#8a9099]"> (you)</span>
      </li>
    </ul>

    <div v-if="order.requester.id === viewerId" class="mt-4">
      <label for="share-link" class="text-sm font-medium text-[#111]">Share this link to invite people</label>
      <div class="mt-1 flex gap-2">
        <input id="share-link" :value="link" readonly class="min-w-0 flex-1 bg-[#f3f3f3] px-2 py-1.5 text-sm text-[#25313c]" @focus="($event.target as HTMLInputElement).select()">
        <button type="button" class="shrink-0 rounded-md border border-[#d3d7db] px-3 text-sm font-medium text-[#173a73] hover:bg-[#f7f9fc]" @click="copy">
          {{ copied ? "Copied" : "Copy" }}
        </button>
      </div>
    </div>

    <button
      v-else-if="!isMember(order, viewerId)"
      type="button"
      :disabled="busy"
      class="mt-4 w-full rounded-md bg-[#7a5cc2] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#6a4cb2]"
      @click="emit('join')"
    >
      Join this group order
    </button>
  </section>
</template>
