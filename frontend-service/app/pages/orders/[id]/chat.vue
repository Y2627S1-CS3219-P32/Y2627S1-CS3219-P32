<script setup lang="ts">
import type { ChatMessage } from "#shared/services/chat-service/types";
import type { Order } from "#shared/services/order-service/types";
import { statusOf, useViewerId } from "~/services/order-service/composables/useOrders";
import { personName } from "~/services/order-service/order-view";

definePageMeta({ middleware: "auth" });

const route = useRoute();
const id = String(route.params.id);
const orderPath = `/api/order-service/orders/${encodeURIComponent(id)}`;
const messagesPath = `/api/chat-service/orders/${encodeURIComponent(id)}/messages`;
const { data: order, error: orderError } = await useFetch<Order>(orderPath);
const viewerId = useViewerId();
const {
  data: messages,
  error: chatError,
  refresh: refreshMessages,
} = await useFetch<ChatMessage[]>(messagesPath, { default: () => [] });

const text = ref("");
const sending = ref(false);
const sendError = ref("");
let pollTimer: ReturnType<typeof setInterval> | undefined;

const error = computed(() => chatError.value ?? orderError.value);

async function send() {
  const body = text.value.trim();
  if (!body || sending.value) return;
  sending.value = true;
  sendError.value = "";
  try {
    await $fetch(messagesPath, { method: "POST", body: { body } });
    text.value = "";
    await refreshMessages();
  } catch (cause) {
    sendError.value = getApiErrorMessage(cause) ?? "Your message could not be sent.";
  } finally {
    sending.value = false;
  }
}

onMounted(() => {
  pollTimer = setInterval(() => void refreshMessages(), 2500);
});
onBeforeUnmount(() => clearInterval(pollTimer));

watch(error, (value) => {
  if (statusOf(value) === 401) navigateTo({ path: "/login", query: { redirect: route.fullPath } });
}, { immediate: true });

function senderName(senderId: number): string {
  if (!order.value) return "Unknown user";
  if (senderId === order.value.requester.id) return personName(order.value.requester);
  if (senderId === order.value.courier?.id) return personName(order.value.courier);
  const member = order.value.members.find(({ id: memberId }) => memberId === senderId);
  if (member) return personName(member);
  return "Unknown user";
}
</script>

<template>
  <main class="min-h-screen bg-[#f7f9fc]">
    <div class="mx-auto max-w-3xl px-4 pt-6 pb-24 md:px-8 md:pt-10">
      <NuxtLink :to="`/orders/${encodeURIComponent(id)}`" class="text-sm font-medium text-[#173a73] underline">
        Back to order
      </NuxtLink>
      <h1 class="mt-4 mb-2 text-center text-3xl font-semibold tracking-tight text-[#111] md:text-4xl">Order chat</h1>
      <p v-if="order" class="mb-6 text-center text-sm text-[#5b6570]">{{ order.title }}</p>

      <p v-if="error" role="alert" class="rounded-md bg-[#fdf2f2] px-4 py-3 text-center text-sm text-[#c62828]">
        {{ statusOf(error) === 403 ? "Only group participants and the assigned courier can access this chat." : statusOf(error) === 404 ? "This chatroom does not exist." : getApiErrorMessage(error) ?? "The chat could not be loaded." }}
      </p>

      <section v-else class="flex min-h-[65vh] flex-col overflow-hidden rounded-2xl border border-[#e1e6eb] bg-white shadow-sm">
        <div class="flex-1 space-y-3 overflow-y-auto p-4 md:p-6" aria-live="polite" aria-label="Chat messages">
          <p v-if="messages.length === 0" class="py-10 text-center text-sm text-[#5b6570]">
            No messages yet. Send a message to get started.
          </p>
          <article
            v-for="message in messages"
            :key="message.id"
            class="max-w-[85%] rounded-2xl px-4 py-3 text-sm"
            :class="message.senderId === viewerId ? 'ml-auto bg-[#173a73] text-white' : 'bg-[#eef4fa] text-[#18212b]'"
          >
            <p class="mb-1 text-xs opacity-75">{{ senderName(message.senderId) }}</p>
            <p class="whitespace-pre-wrap break-words">{{ message.body }}</p>
            <time class="mt-1 block text-right text-[11px] opacity-70" :datetime="message.sentAt">
              {{ new Date(message.sentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) }}
            </time>
          </article>
        </div>

        <form class="border-t border-[#e1e6eb] p-3 md:p-4" @submit.prevent="send">
          <label for="chat-message" class="sr-only">Message</label>
          <div class="flex items-end gap-2">
            <textarea
              id="chat-message"
              v-model="text"
              rows="2"
              maxlength="2000"
              placeholder="Write a message..."
              class="min-h-12 flex-1 resize-y rounded-xl border border-[#cbd3dc] px-3 py-2 text-sm outline-none focus:border-[#173a73] focus:ring-2 focus:ring-[#173a73]/20"
              @keydown.enter.exact.prevent="send"
            />
            <button
              type="submit"
              :disabled="sending || !text.trim()"
              class="rounded-xl bg-[#173a73] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#0f2c5c] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {{ sending ? "Sending…" : "Send" }}
            </button>
          </div>
          <p v-if="sendError" role="alert" class="mt-2 text-sm text-[#c62828]">{{ sendError }}</p>
        </form>
      </section>
    </div>
  </main>
</template>
