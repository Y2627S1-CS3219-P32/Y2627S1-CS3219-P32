import type { H3Event } from "h3";
import type { ChatMessage, ChatMessageCreate } from "#shared/services/chat-service/types";

const FORWARDED_STATUSES = new Set([400, 401, 403, 404, 409]);

function options(event: H3Event) {
  const token = getCookie(event, "user_access_token");
  if (!token) throw createError({ statusCode: 401, message: "A login is required." });
  return {
    baseURL: useRuntimeConfig(event).chatServiceBaseUrl,
    headers: { authorization: `Bearer ${token}` },
    timeout: 5000,
    retry: 0 as const,
  };
}

function toChatServiceError(error: unknown) {
  if (typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" && FORWARDED_STATUSES.has(error.statusCode)) {
    const data = "data" in error ? error.data : undefined;
    const message = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
      ? data.error
      : "The chat request was rejected.";
    return createError({ statusCode: error.statusCode, message, data: { error: message } });
  }
  return createError({ statusCode: 502, message: "Chat is temporarily unavailable. Please try again." });
}

async function call<T>(event: H3Event, path: string, init: Record<string, unknown> = {}): Promise<T> {
  const base = options(event);
  try {
    return (await $fetch(path, { ...base, ...init })) as T;
  } catch (error) {
    throw toChatServiceError(error);
  }
}

const messagesPath = (id: string) => `/orders/${encodeURIComponent(id)}/messages`;

export const getChatMessages = (event: H3Event, id: string) =>
  call<ChatMessage[]>(event, messagesPath(id));

export const sendChatMessage = (event: H3Event, id: string, body: ChatMessageCreate) =>
  call<ChatMessage>(event, messagesPath(id), { method: "POST", body });
