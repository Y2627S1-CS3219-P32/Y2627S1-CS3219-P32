import { getChatMessages } from "../../../../services/chat-service/client";

export default defineEventHandler((event) => getChatMessages(event, getRouterParam(event, "id") ?? ""));
