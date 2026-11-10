<script setup lang="ts">
import MarkdownIt from 'markdown-it';
import type {
  Conversation,
  Message,
  Turn,
  History,
  Page,
  AcceptedTurn,
  Mandate,
  StreamEvent,
} from '#shared/services/agent-service/types';
definePageMeta({ middleware: 'auth' });
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true }),
  api = '/api/agent-service/conversations';
const {
  data: chats,
  refresh: refreshChats,
} = await useFetch<Page<Conversation>>(api, {
  default: () => ({ items: [], next_cursor: null }),
});
const selected = ref<string | null>(null),
  messages = shallowRef<Message[]>([]),
  turns = shallowRef<Turn[]>([]),
  draft = ref(''),
  sending = ref(false),
  loading = ref(false),
  activity = ref('');
const provisional = ref<Record<string, { turn: string; text: string }>>({}),
  activeStreams = new Map<string, string>();
const retiredStreams = new Set<string>();
const mandateUpdates = ref<Record<string, Mandate>>({});
const processing = computed(() => turns.value.some((turn) => turn.status === 'processing'));
const continuationTriggers = computed(
  () =>
    new Set<string>(
      turns.value
        .filter((turn) => turn.client_request_id.startsWith('approval:'))
        .map((turn) => turn.trigger_message_id),
    ),
);
const visible = computed(() =>
  messages.value.filter(
    (message) =>
      !continuationTriggers.value.has(message.id) &&
      (message.content.kind === 'mandate' ||
        message.content.kind === 'text' ||
        (message.content.kind === 'tool_result' &&
          message.content.result.ok &&
          message.content.result.resource_id)),
  ),
);
const streamed = computed(() =>
  Object.entries(provisional.value).filter(
    ([id, value]) => value.text && !messages.value.some((message) => message.id === id),
  ),
);
let source: EventSource | undefined,
  version = 0,
  historyVersion = 0;
const seenEvents = new Set<string>();
let pendingRequest: { conversation: string; text: string; id: string } | undefined;
const composer = ref<HTMLTextAreaElement | null>(null);
watch(draft, async () => {
  await nextTick();
  if (!composer.value) return;
  composer.value.style.height = 'auto';
  composer.value.style.height = `${Math.min(composer.value.scrollHeight, 192)}px`;
});
async function fail(e: unknown) {
  if (e && typeof e === 'object' && 'statusCode' in e && e.statusCode === 401) {
    await navigateTo('/login');
    return;
  }
}
async function history(id: string) {
  const current = ++historyVersion;
  const all: Message[] = [],
    states = new Map<string, Turn>();
  let cursor: string | null = null;
  do {
    const page: History = await $fetch<History>(`${api}/${id}/messages`, {
      query: cursor ? { cursor } : {},
    });
    all.push(...page.items);
    for (const turn of page.turns) states.set(turn.id, turn);
    cursor = page.next_cursor;
  } while (cursor);
  if (selected.value !== id || current !== historyVersion) return;
  messages.value = all;
  turns.value = [...states.values()];
  const terminal = new Set<string>(
    turns.value.filter((turn) => turn.status !== 'processing').map((turn) => turn.id),
  );
  provisional.value = Object.fromEntries(
    Object.entries(provisional.value).filter(([, value]) => !terminal.has(value.turn)),
  );
  if (!processing.value) activity.value = '';
}
function connect(id: string) {
  source?.close();
  source = new EventSource(`${api}/${id}/events`);
  source.onopen = () => {
    void history(id).catch(fail);
    void refreshChats();
  };
  source.addEventListener('resync_required', () => {
    if (selected.value === id) {
      provisional.value = {};
      activeStreams.clear();
      retiredStreams.clear();
      void history(id).catch(fail);
    }
  });
  for (const name of [
    'message_started',
    'message_reset',
    'message_delta',
    'tool_status',
    'mandate_proposed',
    'message_completed',
    'turn_completed',
    'turn_failed',
  ])
    source.addEventListener(name, (event) => {
      if (selected.value !== id || !(event instanceof MessageEvent)) return;
      const frame: StreamEvent = JSON.parse(event.data);
      if (seenEvents.has(frame.event_id)) return;
      seenEvents.add(frame.event_id);
      if (seenEvents.size > 2000) {
        const first = seenEvents.values().next().value;
        if (first) seenEvents.delete(first);
      }
      if (retiredStreams.has(frame.stream_id)) return;
      const prior = activeStreams.get(frame.turn_id);
      if (prior && prior !== frame.stream_id) {
        if (frame.type !== 'message_reset') return;
        retiredStreams.add(prior);
        provisional.value = Object.fromEntries(
          Object.entries(provisional.value).filter(([, value]) => value.turn !== frame.turn_id),
        );
      }
      activeStreams.set(frame.turn_id, frame.stream_id);
      if (frame.type === 'message_delta') {
        const current = provisional.value[frame.message_id] ?? {
          turn: frame.turn_id,
          text: '',
        };
        provisional.value = {
          ...provisional.value,
          [frame.message_id]: { ...current, text: current.text + frame.text },
        };
      }
      if (frame.type === 'tool_status') activity.value = frame.display_text;
      if (
        frame.type === 'turn_completed' ||
        frame.type === 'turn_failed' ||
        frame.type === 'mandate_proposed'
      ) {
        void history(id).catch(fail);
        void refreshChats();
      }
    });
}
async function open(id: string) {
  closePicker();
  const current = ++version;
  source?.close();
  selected.value = id;
  messages.value = [];
  turns.value = [];
  provisional.value = {};
  activeStreams.clear();
  retiredStreams.clear();
  seenEvents.clear();
  activity.value = '';
  loading.value = true;
  try {
    connect(id);
    await history(id);
  } catch (e) {
    await fail(e);
  } finally {
    if (current === version) loading.value = false;
  }
}
async function create() {
  const conversation = await $fetch<Conversation>(api, {
    method: 'POST',
    body: { title: 'New conversation' },
  });
  await refreshChats();
  await open(conversation.id);
  return conversation.id;
}
function newChat() {
  closePicker();
  version++;
  historyVersion++;
  source?.close();
  selected.value = null;
  messages.value = [];
  turns.value = [];
  provisional.value = {};
  activeStreams.clear();
  retiredStreams.clear();
  seenEvents.clear();
  draft.value = '';
  activity.value = '';
  loading.value = false;
  pendingRequest = undefined;
}
async function send() {
  const text = draft.value.trim();
  if (!text || sending.value || processing.value) return;
  sending.value = true;
  try {
    const id = selected.value ?? (await create());
    if (!pendingRequest || pendingRequest.conversation !== id || pendingRequest.text !== text)
      pendingRequest = { conversation: id, text, id: crypto.randomUUID() };
    await $fetch<AcceptedTurn>(`${api}/${id}/messages`, {
      method: 'POST',
      body: { client_request_id: pendingRequest.id, text },
    });
    pendingRequest = undefined;
    draft.value = '';
    await history(id);
    await refreshChats();
  } catch (e) {
    await fail(e);
  } finally {
    sending.value = false;
  }
}
async function changed(mandate: Mandate) {
  mandateUpdates.value = { ...mandateUpdates.value, [mandate.id]: mandate };
  if (selected.value) await history(selected.value);
}
const chatPicker = ref<HTMLDialogElement>();
const pickerOpen = ref(false);
const deleting = ref<Conversation | null>(null);
const deleteBusy = ref(false);
function openPicker() {
  chatPicker.value?.showModal();
  pickerOpen.value = true;
}
function closePicker() {
  chatPicker.value?.close();
  pickerOpen.value = false;
}
async function moreChats() {
  const next = await $fetch<Page<Conversation>>(api, {
    query: { cursor: chats.value.next_cursor },
  });
  chats.value = { items: [...chats.value.items, ...next.items], next_cursor: next.next_cursor };
}
function confirmDelete(chat: Conversation) {
  closePicker();
  deleting.value = chat;
}
async function deleteChat() {
  const chat = deleting.value;
  if (!chat || deleteBusy.value) return;
  deleteBusy.value = true;
  try {
    await $fetch(`${api}/${chat.id}`, { method: 'DELETE', body: {} });
    if (selected.value === chat.id) newChat();
    deleting.value = null;
    await refreshChats();
  } catch (e) {
    deleting.value = null;
    await fail(e);
  } finally {
    deleteBusy.value = false;
  }
}
onMounted(() => {
  if (chats.value.items[0]) void open(chats.value.items[0].id);
  const route = useRoute();
  if (route.query.chats === 'open') {
    if (window.matchMedia('(max-width: 767px)').matches) openPicker();
    const query = { ...route.query };
    delete query.chats;
    void useRouter().replace({ query });
  }
});
onBeforeUnmount(() => {
  version++;
  source?.close();
});
</script>
<template>
  <main class="mx-auto flex h-[calc(100dvh-7rem)] max-w-7xl gap-4 p-4 md:p-6">
    <FriendRail :picker-open="pickerOpen" @chats="openPicker" />
    <aside class="hidden w-56 shrink-0 overflow-y-auto md:block">
      <ConversationList
        :page="chats"
        :selected="selected"
        :busy="sending || deleteBusy"
        @new-chat="newChat"
        @select="open"
        @delete="confirmDelete"
        @more="moreChats().catch(fail)"
      />
    </aside>
    <dialog
      ref="chatPicker"
      aria-labelledby="chat-picker-title"
      class="chat-picker fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-80 max-w-[85vw] border-r border-slate-200 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      @close="pickerOpen = false"
      @click="$event.target === chatPicker && closePicker()"
    >
      <header class="mb-5 flex items-center justify-between">
        <h2 id="chat-picker-title" class="font-semibold">Conversations</h2>
        <button
          aria-label="Close conversation picker"
          class="rounded-lg px-3 py-2 text-xl text-slate-500 hover:bg-slate-100"
          @click="closePicker"
        >
          ×
        </button>
      </header>
      <ConversationList
        :page="chats"
        :selected="selected"
        :busy="sending || deleteBusy"
        @new-chat="newChat"
        @select="open"
        @delete="confirmDelete"
        @more="moreChats().catch(fail)"
      />
    </dialog>
    <ConfirmDeleteDialog
      v-if="deleting"
      title="Delete chat?"
      :message="`Delete “${deleting.title}”? This permanently deletes its conversation history. Orders and mandates are kept.`"
      @cancel="deleting = null"
      @confirm="deleteChat"
    />
    <section class="flex min-w-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white">
      <header class="flex items-center justify-between border-b border-slate-100 p-4">
        <h1 class="font-semibold">Friend</h1>
        <button
          class="inline-flex items-center gap-2 text-sm md:hidden"
          :disabled="sending"
          @click="newChat"
        >
          <svg
            aria-hidden="true"
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5M13.5 6.5l4-4a2.1 2.1 0 0 1 3 3l-9 9-4 1 1-4 5-5Z" />
          </svg>
          New chat
        </button>
      </header>
      <div
        class="min-h-0 flex-1 space-y-5 overflow-y-auto p-5"
        aria-live="polite"
        aria-relevant="additions text"
      >
        <p v-if="!messages.length && !loading" class="text-slate-600">
          Hi! What can I help you with today?
        </p>
        <p v-if="loading" role="status" class="text-sm text-slate-500">Loading conversation…</p>
        <article
          v-for="message in visible"
          :key="message.id"
          :class="
            message.role === 'user' ? 'ml-auto max-w-xl rounded-xl bg-slate-100 p-4' : 'max-w-2xl'
          "
        >
          <p class="mb-2 text-xs font-medium text-slate-500">
            {{ message.role === 'user' ? 'You' : 'Friend' }}
          </p>
          <div
            v-if="message.content.kind === 'text'"
            class="agent-markdown break-words"
            v-html="markdown.render(message.content.text)"
          />
          <MandateCard
            v-else-if="message.content.kind === 'mandate'"
            chat
            :mandate="mandateUpdates[message.content.mandate.id] ?? message.content.mandate"
            @changed="changed"
          />
          <OrderResultCard
            v-else-if="
              message.content.kind === 'tool_result' &&
              message.content.result.ok &&
              message.content.result.resource_id
            "
            :order-id="message.content.result.resource_id"
            :data="message.content.result.data"
          />
        </article>
        <div
          v-for="[id, value] in streamed"
          :key="id"
          class="agent-markdown max-w-2xl break-words"
          v-html="markdown.render(value.text)"
        />
        <p v-if="processing" role="status" class="text-sm text-slate-500">
          {{ activity || 'Thinking…' }}
        </p>
      </div>
      <form class="space-y-3 border-t border-slate-100 p-4" @submit.prevent="send">
        <label class="sr-only" for="agent-message">Message Friend</label>
        <div class="flex items-end gap-3">
          <textarea
            ref="composer"
            id="agent-message"
            v-model="draft"
            rows="2"
            maxlength="16000"
            class="max-h-48 min-w-0 flex-1 resize-none overflow-y-auto rounded-xl border border-slate-300 p-3"
            placeholder="Ask about a campus errand…"
            :disabled="sending"
            @keydown.enter.exact.prevent="send"
          /><button
            type="submit"
            :disabled="sending || processing || !draft.trim()"
            class="rounded-xl bg-slate-900 px-4 py-3 text-white disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </section>
  </main>
</template>
<style scoped>
.chat-picker[open] {
  animation: slide-in 180ms ease-out;
}
@keyframes slide-in {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .chat-picker[open] {
    animation: none;
  }
}

.agent-markdown :deep(p + p),
.agent-markdown :deep(ul),
.agent-markdown :deep(ol) {
  margin-top: 0.75rem;
}
.agent-markdown :deep(ul) {
  list-style: disc;
  padding-left: 1.5rem;
}
.agent-markdown :deep(ol) {
  list-style: decimal;
  padding-left: 1.5rem;
}
.agent-markdown :deep(a) {
  color: #1e40af;
  text-decoration: underline;
}
.agent-markdown :deep(pre) {
  overflow-x: auto;
  background: #f1f5f9;
  padding: 1rem;
  border-radius: 0.5rem;
}
</style>
