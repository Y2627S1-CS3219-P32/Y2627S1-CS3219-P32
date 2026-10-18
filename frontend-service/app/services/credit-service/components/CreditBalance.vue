<!-- AI Assistance Disclosure: Codex (GPT-6), 2026-10-18.
Scope: Responsive profile credit summary and request states. Author review: Pending. -->
<script setup lang="ts">
import type { CreditBalance } from "#shared/services/credit-service/types";

const props = defineProps<{ userId: number }>();
const { data: balance, status, error, refresh } = useFetch<CreditBalance>("/api/credit-service/me", {
  key: () => `credit-balance-${props.userId}`,
  server: false,
});
const accountPending = computed(() => {
  const response: unknown = error.value?.data;
  const data = typeof response === "object" && response !== null && "data" in response ? response.data : undefined;
  return error.value?.statusCode === 503 && typeof data === "object" && data !== null &&
    "code" in data && data.code === "ACCOUNT_PENDING";
});
const numberFormat = new Intl.NumberFormat("en-SG", { maximumFractionDigits: 0 });
</script>

<template>
  <section
    aria-label="Credits"
    :aria-busy="status === 'idle' || status === 'pending'"
    class="rounded-lg border border-[#e1e6eb] bg-[#f7f9fc] p-5 sm:p-6"
  >
    <h2 class="text-lg font-semibold">Credits</h2>
    <div class="mt-4" aria-live="polite" aria-atomic="true">
      <p v-if="status === 'idle' || status === 'pending'" class="text-sm text-[#5b6570]">
        Loading your credits...
      </p>
      <div v-else-if="error || !balance">
        <p class="text-sm text-[#5b6570]">
          {{ accountPending ? 'Your credit account is being set up. Check again shortly.' : 'Credits are temporarily unavailable. Try again.' }}
        </p>
        <button
          type="button"
          class="mt-3 min-h-11 rounded-lg border border-[#cfd5da] bg-white px-4 py-2 text-sm font-medium text-[#064784] hover:bg-[#eef3f8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#064784]"
          @click="refresh()"
        >
          Retry
        </button>
      </div>
      <dl v-else class="grid min-w-0 gap-5">
        <div class="min-w-0">
          <dt class="text-sm font-medium">Available to spend</dt>
          <dd class="mt-1 break-all text-4xl font-bold tabular-nums sm:text-5xl">
            {{ numberFormat.format(balance.availableCredits) }}
          </dd>
        </div>
        <div class="grid min-w-0 grid-cols-2 gap-4 border-t border-[#e1e6eb] pt-4">
          <div class="min-w-0">
            <dt class="text-sm text-[#5b6570]">Reserved</dt>
            <dd class="mt-1 break-all text-xl font-semibold tabular-nums">{{ numberFormat.format(balance.reservedCredits) }}</dd>
          </div>
          <div class="min-w-0 text-[#5b6570]">
            <dt class="text-sm">Total</dt>
            <dd class="mt-1 break-all text-xl tabular-nums">{{ numberFormat.format(balance.totalCredits) }}</dd>
          </div>
        </div>
      </dl>
    </div>
    <p class="mt-4 text-sm text-[#5b6570]">Reserved credits are held for your active requests.</p>
  </section>
</template>
