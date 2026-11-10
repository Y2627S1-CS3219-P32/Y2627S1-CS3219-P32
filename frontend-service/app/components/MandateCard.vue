<script setup lang="ts">
import type { Mandate } from '#shared/services/agent-service/types';
const props = defineProps<{ mandate: Mandate; chat?: boolean }>();
const actions = ref<HTMLDetailsElement | null>(null);
function closeActions() {
  if (actions.value) actions.value.open = false;
}
function onDocumentClick(event: MouseEvent) {
  if (event.target instanceof Node && !actions.value?.contains(event.target)) closeActions();
}
onMounted(() => document.addEventListener('click', onDocumentClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick));
const mandate = shallowRef(props.mandate);
watch(
  () => props.mandate,
  (value) => {
    mandate.value = value;
  },
);
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(expiryTimer));
watch(mandate, value => {
  clearTimeout(expiryTimer);
  if (value.status !== 'pending' || !value.approval_expires_at) return;
  expiryTimer = setTimeout(async () => {
    mandate.value = { ...mandate.value, status: 'expired' };
    try { mandate.value = await $fetch<Mandate>(`/api/mandate-service/mandates/${value.id}`); } catch { /* Keep the expired proposal visible. */ }
  }, Math.max(0, Date.parse(value.approval_expires_at) - Date.now()));
}, { immediate: true });
const compact = computed(() => props.chat && mandate.value.status !== 'pending');
const statusLabel = computed(() =>
  mandate.value.status === 'active'
    ? 'Approved'
    : mandate.value.status.charAt(0).toUpperCase() + mandate.value.status.slice(1),
);
onMounted(async () => {
  try {
    mandate.value = await $fetch<Mandate>(`/api/mandate-service/mandates/${props.mandate.id}`);
    if (!props.chat) emit('changed', mandate.value);
  } catch {
    // Keep the rendered mandate when its refresh fails.
  }
});
const emit = defineEmits<{ changed: [Mandate] }>();
const busy = ref(false);
const { data: suppliers, error: supplierError } = await useFetch<{ id: string; name: string }[]>(
  '/api/supplier-service/suppliers',
  {
    key: 'mandate-suppliers',
    default: () => [],
  },
);
const allowed = computed(() =>
  mandate.value.terms.constraints
    .filter((value) => value.type === 'supplier_id')
    .map((value) => value.value),
);
const amount = computed(
  () => mandate.value.terms.constraints.find((value) => value.type === 'max_credit_amount')?.value,
);
const unresolved = computed(() =>
  allowed.value.some((id) => !suppliers.value.some((supplier) => supplier.id === id)),
);
const supplierName = (id: string) =>
  suppliers.value.find((supplier) => supplier.id === id)?.name ?? 'Supplier unavailable';
const date = (value: string) =>
  new Date(value).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
async function act(action: 'approve' | 'pause' | 'resume' | 'revoke') {
  closeActions();
  busy.value = true;
  try {
    mandate.value = await $fetch<Mandate>(
      `/api/mandate-service/mandates/${mandate.value.id}/${action}`,
      {
        method: 'POST',
        body: action === 'approve' ? { consent: true, terms_hash: mandate.value.terms_hash } : {},
      },
    );
    emit('changed', mandate.value);
  } catch {
    // Keep the previous mandate state when its update fails.
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Transition name="mandate" mode="out-in">
    <section
      v-if="compact"
      key="receipt"
      class="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
      aria-live="polite"
    >
      <span
        class="h-2 w-2 shrink-0 rounded-full"
        :class="mandate.status === 'active' ? 'bg-emerald-500' : 'bg-slate-400'"
        aria-hidden="true"
      />
      <div>
        <p class="text-sm font-medium">{{ mandate.title }}</p>
        <p class="text-xs text-slate-500">{{ mandate.status === 'expired' && chat ? 'Proposal expired—ask Friend for a new proposal.' : statusLabel }}</p>
      </div>
    </section>
    <section
      v-else
      key="terms"
      class="space-y-4 rounded-xl border border-slate-200 bg-white p-5"
      aria-label="Mandate terms"
    >
      <header class="flex items-center justify-between gap-3">
        <h3 class="font-semibold">{{ mandate.title }}</h3>
        <div class="flex shrink-0 items-center gap-2">
          <span class="rounded-full bg-slate-100 px-3 py-1 text-xs">{{ mandate.status }}</span>
          <details
            v-if="!chat && ['active', 'paused'].includes(mandate.status)"
            ref="actions"
            class="relative"
            @keydown.esc.prevent="closeActions(); actions?.querySelector('summary')?.focus()"
          >
            <summary
              class="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg text-xl hover:bg-slate-100 [&::-webkit-details-marker]:hidden"
              :aria-label="`Actions for ${mandate.title}`"
            >
              <span aria-hidden="true">⋯</span>
            </summary>
            <div class="absolute right-0 z-10 mt-1 w-36 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
              <button
                type="button"
                :disabled="busy"
                class="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 disabled:opacity-50"
                @click="act(mandate.status === 'active' ? 'pause' : 'resume')"
              >
                {{ mandate.status === 'active' ? 'Pause' : 'Resume' }}
              </button>
              <button
                type="button"
                :disabled="busy"
                class="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                @click="act('revoke')"
              >
                Revoke
              </button>
            </div>
          </details>
        </div>
      </header>
      <p class="text-sm text-slate-600">Authorizes order creation within these terms.</p>
      <dl class="space-y-3 text-sm">
        <div>
          <dt class="text-slate-500">Suppliers</dt>
          <dd v-if="!allowed.length">Unrestricted suppliers</dd>
          <dd v-for="id in allowed" :key="id">
            {{ supplierName(id) }}
          </dd>
        </div>
        <div>
          <dt class="text-slate-500">Maximum reward per order</dt>
          <dd>
            {{ amount === undefined ? 'Unrestricted amount' : `${amount} credits` }}
          </dd>
        </div>
        <div v-if="mandate.status === 'revoked'">
          <dt class="text-slate-500">Revoked at</dt>
          <dd>{{ mandate.revoked_at ? `${date(mandate.revoked_at)} SGT` : 'Unavailable' }}</dd>
        </div>
        <template v-else>
          <div>
            <dt class="text-slate-500">Valid from</dt>
            <dd>{{ date(mandate.terms.starts_at) }} SGT</dd>
          </div>
          <div>
            <dt class="text-slate-500">Expires</dt>
            <dd>
              {{
                mandate.terms.expires_at === null
                  ? 'No expiry'
                  : `${date(mandate.terms.expires_at)} SGT`
              }}
            </dd>
          </div>
        </template>
      </dl>
      <div class="flex flex-wrap gap-3">
        <button
          v-if="mandate.status === 'pending'"
          :disabled="busy || unresolved || (!!supplierError && allowed.length > 0)"
          class="rounded-lg bg-blue-800 px-4 py-2 text-sm text-white disabled:opacity-50"
          @click="act('approve')"
        >
          Approve these terms
        </button>
      </div>
    </section>
  </Transition>
</template>
<style scoped>
.mandate-enter-active,
.mandate-leave-active {
  transition:
    opacity 160ms ease,
    transform 160ms ease;
}
.mandate-enter-from,
.mandate-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
@media (prefers-reduced-motion: reduce) {
  .mandate-enter-active,
  .mandate-leave-active {
    transition: none;
  }
}
</style>
