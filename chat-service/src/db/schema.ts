import { index, integer, pgTable, primaryKey, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const chatRooms = pgTable(
  "chat_rooms",
  {
    orderId: uuid("order_id").primaryKey(),
    requesterId: integer("requester_id").notNull(),
    courierId: integer("courier_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [index("chat_rooms_expires_at_idx").on(table.expiresAt)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey(),
    orderId: uuid("order_id").notNull().references(() => chatRooms.orderId, { onDelete: "cascade" }),
    senderId: integer("sender_id").notNull(),
    body: varchar("body", { length: 2000 }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("chat_messages_order_sent_idx").on(table.orderId, table.sentAt, table.id)],
);

export const chatRoomMembers = pgTable(
  "chat_room_members",
  {
    orderId: uuid("order_id").notNull().references(() => chatRooms.orderId, { onDelete: "cascade" }),
    userId: integer("user_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orderId, table.userId] }),
    index("chat_room_members_user_idx").on(table.userId),
  ],
);
