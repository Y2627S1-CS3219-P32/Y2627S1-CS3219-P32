<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
Scope: Collaborative group-order description: a textarea bound to a Yjs text shared through
the sync service (y-websocket protocol, ticket per connection, reconnect with backoff), who
else is editing, and placing the order. Author review: Pending.
Claude Code (Opus 5.5), 2026-10-17. Scope: CodeMirror 6 editor with y-codemirror.next, showing
everyone's cursors and selections with their names. Author review: Pending. -->
<script setup lang="ts">
import { defaultKeymap } from "@codemirror/commands";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

const props = defineProps<{ orderId: string; viewerName: string; canPlace: boolean }>();
const emit = defineEmits<{ closed: []; placed: [] }>();

const MAX = 500;
const CLOSE_PLACED = 4003;
const CLOSE_CANCELLED = 4004;
// Cursor colours, picked per person from their name so everyone sees the same colour.
const COLOURS = ["#3b78c4", "#d4a03a", "#3f9a62", "#d9534f", "#7a5cc2", "#c2185b", "#00838f", "#ef6c00"];

const doc = new Y.Doc();
const ytext = doc.getText("description");
const host = ref<HTMLElement | null>(null);
const length = ref(0);
const connection = ref<"connecting" | "connected" | "reconnecting">("connecting");
const synced = ref(false);
const others = ref<{ name: string; color: string }[]>([]);
const placing = ref(false);
const error = ref("");

let provider: WebsocketProvider | undefined;
let view: EditorView | undefined;
const editable = new Compartment();
let stopped = false;
let retryDelay = 1000;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let lastLocalEdit = 0;

function colourFor(name: string): string {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return COLOURS[hash % COLOURS.length]!;
}

ytext.observe((_event, transaction) => {
  length.value = ytext.toString().trim().length;
  if (transaction.local) lastLocalEdit = Date.now();
});

function updateOthers() {
  if (!provider) return;
  const people = new Map<string, string>();
  for (const [clientId, state] of provider.awareness.getStates()) {
    const user = (state as { user?: { name?: string; color?: string } }).user;
    if (clientId !== doc.clientID && user?.name) people.set(user.name, user.color ?? "#8a9099");
  }
  others.value = [...people].map(([name, color]) => ({ name, color }));
}

function scheduleReconnect() {
  if (stopped || retryTimer) return;
  connection.value = "reconnecting";
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    connect();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 30_000);
}

function createEditor(awareness: WebsocketProvider["awareness"]) {
  if (!host.value) return;
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: ytext.toString(),
      extensions: [
        keymap.of([...yUndoManagerKeymap, ...defaultKeymap]),
        yCollab(ytext, awareness),
        EditorView.lineWrapping,
        placeholder("Everyone in the group can add what they want here."),
        editable.of(EditorView.editable.of(false)),
        EditorView.contentAttributes.of({ "aria-labelledby": "group-editor-heading", "aria-multiline": "true" }),
        EditorView.theme({
          "&": { backgroundColor: "#f3f3f3", fontSize: "15px", color: "#111", minHeight: "12rem" },
          "&.cm-focused": { outline: "2px solid #3b78c4", backgroundColor: "#eceff3" },
          ".cm-content": { fontFamily: "inherit", padding: "8px 4px", minHeight: "12rem" },
          ".cm-scroller": { fontFamily: "inherit" },
          ".cm-ySelectionInfo": { fontFamily: "inherit", fontSize: "11px", padding: "1px 4px", opacity: "1", borderRadius: "3px 3px 3px 0" },
        }),
      ],
    }),
  });
}

async function connect() {
  if (stopped) return;
  let ticket: string;
  try {
    ({ ticket } = await $fetch<{ ticket: string }>("/api/sync-service/ticket", { method: "POST" }));
  } catch {
    scheduleReconnect();
    return;
  }
  if (stopped) return;

  if (!provider) {
    const base = useRuntimeConfig().public.syncServiceUrl;
    provider = new WebsocketProvider(`${base}/documents`, props.orderId, doc, { connect: false, params: { ticket }, disableBc: true });
    const color = colourFor(props.viewerName);
    provider.awareness.setLocalStateField("user", { name: props.viewerName, color, colorLight: `${color}33` });
    provider.awareness.on("change", updateOthers);
    provider.on("status", ({ status }) => {
      if (status === "connected") connection.value = "connected";
    });
    provider.on("sync", (isSynced) => {
      synced.value = isSynced;
      if (isSynced) retryDelay = 1000;
      view?.dispatch({ effects: editable.reconfigure(EditorView.editable.of(isSynced)) });
    });
    provider.on("connection-close", (event) => {
      // Tickets are single use, so the library's own retry would fail: reconnect ourselves.
      if (provider) provider.shouldConnect = false;
      synced.value = false;
      view?.dispatch({ effects: editable.reconfigure(EditorView.editable.of(false)) });
      if (event?.code === CLOSE_PLACED || event?.code === CLOSE_CANCELLED) {
        stopped = true;
        emit("closed");
        return;
      }
      scheduleReconnect();
    });
    createEditor(provider.awareness);
  } else {
    provider.params = { ticket };
  }
  provider.connect();
}

async function place() {
  error.value = "";
  placing.value = true;
  try {
    // Let the last keystrokes reach the sync service first.
    const wait = 600 - (Date.now() - lastLocalEdit);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    await $fetch(`/api/sync-service/documents/${encodeURIComponent(props.orderId)}/place`, { method: "POST" });
    emit("placed");
  } catch (failure) {
    error.value = getApiErrorMessage(failure) ?? "The order could not be placed. Please try again.";
  } finally {
    placing.value = false;
  }
}

onMounted(connect);
onBeforeUnmount(() => {
  stopped = true;
  clearTimeout(retryTimer);
  view?.destroy();
  provider?.destroy();
  doc.destroy();
});

const tooLong = computed(() => length.value > MAX);
</script>

<template>
  <section class="rounded-md bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.14)]" aria-labelledby="group-editor-heading">
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h2 id="group-editor-heading" class="font-semibold text-[#111]">
        Description <span class="font-normal" :class="tooLong ? 'text-[#c62828]' : 'text-[#5b6570]'">({{ length }}/{{ MAX }})</span>
      </h2>
      <p class="flex items-center gap-1.5 text-xs text-[#5b6570]" aria-live="polite">
        <span class="size-2 rounded-full" :class="connection === 'connected' && synced ? 'bg-[#3f9a62]' : 'bg-[#d4a03a]'" aria-hidden="true" />
        {{ connection === "connected" && synced ? "Live" : connection === "reconnecting" ? "Reconnecting…" : "Connecting…" }}
      </p>
    </div>
    <div ref="host" class="overflow-hidden" :class="{ 'opacity-60': !synced }" />
    <p class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#5b6570]">
      <template v-if="others.length === 0">Nobody else is editing right now.</template>
      <template v-else>
        Also editing:
        <span v-for="person in others" :key="person.name" class="inline-flex items-center gap-1">
          <span class="size-2.5 rounded-full" :style="{ backgroundColor: person.color }" aria-hidden="true" />{{ person.name }}
        </span>
      </template>
    </p>
    <p v-if="tooLong" class="mt-1 text-sm text-[#c62828]">Shorten the description to {{ MAX }} characters before placing the order.</p>
    <p v-if="error" role="alert" class="mt-2 rounded-md bg-[#fdf2f2] px-3 py-2 text-sm text-[#c62828]">{{ error }}</p>
    <button
      v-if="canPlace"
      type="button"
      :disabled="placing || !synced || tooLong || length === 0"
      class="relative mt-4 w-full rounded-md bg-[#173a73] px-10 py-3 text-sm font-medium text-white hover:bg-[#10305f]"
      @click="place"
    >
      Place Order
      <span class="absolute top-1/2 right-5 -translate-y-1/2" aria-hidden="true">→</span>
    </button>
  </section>
</template>
