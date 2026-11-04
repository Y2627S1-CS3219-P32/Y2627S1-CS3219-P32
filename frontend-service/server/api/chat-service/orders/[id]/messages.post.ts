import type { ChatMessageCreate } from "#shared/services/chat-service/types";
import { sendChatMessage } from "../../../../services/chat-service/client";

export default defineEventHandler(async (event) => {
  const body = await readBody<ChatMessageCreate>(event);
  return sendChatMessage(event, getRouterParam(event, "id") ?? "", body);
});
