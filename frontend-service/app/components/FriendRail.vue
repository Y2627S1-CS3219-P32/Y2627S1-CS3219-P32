<script setup lang="ts">
defineProps<{ pickerOpen?: boolean }>();
const emit = defineEmits<{ chats: [] }>();
const route = useRoute();
function select(event: MouseEvent, key: string, navigate: (event: MouseEvent) => unknown) {
  if (key !== 'chats' || !window.matchMedia('(max-width: 767px)').matches) {
    void navigate(event);
    return;
  }
  event.preventDefault();
  if (route.path === '/agent') emit('chats');
  else void navigateTo('/agent?chats=open');
}
const items = [
  {
    label: 'Chats',
    to: '/agent',
    key: 'chats',
    path: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z',
  },
  {
    label: 'Mandates',
    to: '/mandates',
    key: 'mandates',
    path: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Zm-4-11 3 3 5-5',
  },
];
const active = computed(() => (route.path === '/mandates' ? 'mandates' : 'chats'));
</script>
<template>
  <nav
    aria-label="Friend navigation"
    class="flex shrink-0 flex-col items-center gap-3 border-r border-slate-200 pr-3"
  >
    <NuxtLink
      v-for="item in items"
      :key="item.key"
      :to="item.to"
      custom
      v-slot="{ href, navigate }"
    >
      <a
        :href="href ?? undefined"
        :title="item.label"
        :aria-haspopup="item.key === 'chats' ? 'dialog' : undefined"
        :aria-expanded="item.key === 'chats' ? !!pickerOpen : undefined"
        @click="select($event, item.key, navigate)"
        :aria-label="item.label"
        :aria-current="active === item.key ? 'page' : undefined"
        :class="[
          'flex h-11 w-11 items-center justify-center rounded-xl transition-colors',
          active === item.key
            ? 'bg-slate-200 text-slate-950'
            : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
        ]"
      >
        <svg
          aria-hidden="true"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path :d="item.path" />
        </svg>
      </a>
    </NuxtLink>
  </nav>
</template>
