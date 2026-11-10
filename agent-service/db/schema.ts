import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Json, MessageContent } from '@campus/agent-contracts/conversation';

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey(),
  userId: integer('user_id').notNull(),
  title: text('title').notNull(),
  nextMessageSeq: bigint('next_message_seq', { mode: 'number' }).notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check('conversations_next_message_seq_check', sql`${table.nextMessageSeq} >= 1`),
  index('conversations_owner').on(table.userId, table.updatedAt),
]);

// Explicit return type breaks the circular turn/message inference. The FK is deferred in migration 0000.
const triggerMessageColumns = (): [AnyPgColumn, AnyPgColumn] => [messages.conversationId, messages.id];

export const turns = pgTable('turns', {
  id: uuid('id').primaryKey(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id),
  triggerMessageId: uuid('trigger_message_id').notNull().unique(),
  clientRequestId: text('client_request_id').notNull(),
  status: text('status', { enum: ['processing', 'completed', 'failed'] }).notNull().default('processing'),
  error: jsonb('error').$type<Json>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, table => [
  unique().on(table.conversationId, table.id),
  unique().on(table.conversationId, table.clientRequestId),
  foreignKey({ name: 'turns_trigger_message_fk', columns: [table.conversationId, table.triggerMessageId], foreignColumns: triggerMessageColumns() }),
  check('turns_completion_check', sql`(${table.finishedAt} IS NULL AND ${table.status} = 'processing') OR
    (${table.finishedAt} IS NOT NULL AND ${table.status} IN ('completed', 'failed'))`),
]);

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id),
  turnId: uuid('turn_id'),
  seq: bigint('seq', { mode: 'number' }).notNull(),
  role: text('role', { enum: ['system', 'user', 'assistant', 'tool'] }).notNull(),
  content: jsonb('content').$type<MessageContent>().notNull(),
  toolCallId: text('tool_call_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique().on(table.conversationId, table.id),
  unique().on(table.conversationId, table.seq),
  foreignKey({ columns: [table.conversationId, table.turnId], foreignColumns: [turns.conversationId, turns.id] }),
  check('messages_seq_check', sql`${table.seq} >= 1`),
  check('messages_role_check', sql`${table.role} IN ('system','user','assistant','tool')`),
  check('messages_tool_call_check', sql`${table.role} <> 'tool' OR (${table.toolCallId} IS NOT NULL AND ${table.turnId} IS NOT NULL)`),
  uniqueIndex('messages_tool_result').on(table.conversationId, table.turnId, table.toolCallId).where(sql`${table.role} = 'tool'`),
  index('messages_turn_history').on(table.conversationId, table.turnId, table.seq),
]);

export const turnOutbox = pgTable('turn_outbox', {
  eventId: uuid('event_id').primaryKey(),
  conversationId: uuid('conversation_id').notNull(),
  turnId: uuid('turn_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').$type<Json>().notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique().on(table.turnId, table.eventType),
  foreignKey({ columns: [table.conversationId, table.turnId], foreignColumns: [turns.conversationId, turns.id] }),
  index('turn_outbox_unpublished').on(table.createdAt).where(sql`${table.publishedAt} IS NULL`),
]);
