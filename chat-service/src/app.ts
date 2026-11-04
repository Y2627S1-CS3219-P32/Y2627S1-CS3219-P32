import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import { desc, eq } from "drizzle-orm";
import { canAccessChat } from "./access.js";
import { getUserId, requireUser } from "./auth.js";
import { db } from "./db/index.js";
import { chatMessages, chatRoomMembers, chatRooms } from "./db/schema.js";
import { HttpError } from "./errors.js";
import { isValidOrderId, publishChatMessage } from "./events.js";

export const app = express();
app.use(express.json({ limit: "10kb" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

function orderIdParam(req: Request): string {
  const id = req.params.orderId;
  if (typeof id !== "string" || !isValidOrderId(id)) throw new HttpError(404, "Chatroom not found");
  return id.toLowerCase();
}

async function accessibleRoom(orderId: string, userId: number) {
  const [room] = await db.select().from(chatRooms).where(eq(chatRooms.orderId, orderId));
  if (!room) throw new HttpError(404, "Chatroom not found");
  const members = await db.select({ userId: chatRoomMembers.userId }).from(chatRoomMembers)
    .where(eq(chatRoomMembers.orderId, orderId));
  if (!canAccessChat({ ...room, memberIds: members.map(({ userId: memberId }) => memberId) }, userId)) {
    throw new HttpError(403, "Only order participants and the assigned courier can access this chat");
  }
  if (room.expiresAt && room.expiresAt.getTime() <= Date.now()) throw new HttpError(404, "Chatroom not found");
  return room;
}

app.get("/orders/:orderId/messages", requireUser, async (req, res) => {
  const orderId = orderIdParam(req);
  await accessibleRoom(orderId, getUserId(res));
  const messages = await db.select().from(chatMessages)
    .where(eq(chatMessages.orderId, orderId))
    .orderBy(desc(chatMessages.sentAt), desc(chatMessages.id))
    .limit(200);
  res.json(messages.reverse());
});

app.post("/orders/:orderId/messages", requireUser, async (req, res) => {
  const orderId = orderIdParam(req);
  const senderId = getUserId(res);
  const room = await accessibleRoom(orderId, senderId);
  if (room.expiresAt) throw new HttpError(409, "This chat is read-only because the order has ended");
  const body: unknown = typeof req.body === "object" && req.body !== null ? req.body.body : undefined;
  if (typeof body !== "string" || body.trim().length === 0 || body.trim().length > 2000) {
    throw new HttpError(400, "Message must contain 1 to 2000 characters");
  }
  const message = await publishChatMessage(orderId, senderId, body.trim());
  res.status(202).json(message);
});

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  if (error instanceof SyntaxError && "status" in error && error.status === 400) {
    res.status(400).json({ error: "Request body contains invalid JSON" });
    return;
  }
  console.error("[chat-service] Request failed", error);
  res.status(500).json({ error: "Chat request failed. Please try again." });
};

app.use(errorHandler);
