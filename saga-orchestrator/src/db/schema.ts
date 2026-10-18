/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
 * Scope: Saga orchestrator tables: one saga per order (its step and the request ids sent
 * to credit), processed message ids, and the outbox of commands to publish.
 * Author review: Pending.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const SAGA_STATES = [
  "RESERVING", // credit.reserve sent, waiting for credit
  "OPEN", // credits held, OpenOrder sent
  "REJECTED", // credit refused the reservation, RejectOrder sent
  "ABORTED", // credit did not answer in time: AbortOrder and credit.release sent
  "RELEASING", // order cancelled or expired, credit.release sent
  "RELEASED", // credits returned to the requester
  "TRANSFERRING", // order completed, credit.transfer sent
  "SETTLED", // reward paid to the courier, SettleOrder sent
  "FAILED", // credit rejected a release or transfer; needs attention
] as const;
export type SagaState = (typeof SAGA_STATES)[number];

const stateList = sql.raw(SAGA_STATES.map((state) => `'${state}'`).join(", "));

export const sagas = pgTable(
  "sagas",
  {
    orderId: uuid("order_id").primaryKey(),
    // Sent with every credit command so its results can be traced back to this saga.
    correlationId: uuid("correlation_id").defaultRandom().notNull(),
    requesterId: integer("requester_id").notNull(),
    amount: integer("amount").notNull(),
    courierId: integer("courier_id"),
    state: text("state").$type<SagaState>().notNull(),
    // Each credit command keeps its request id across retries (credit's idempotency key).
    reserveRequestId: uuid("reserve_request_id").notNull(),
    releaseRequestId: uuid("release_request_id"),
    transferRequestId: uuid("transfer_request_id"),
    reserveDeadline: timestamp("reserve_deadline", { withTimezone: true }),
    // Credit's code for a rejection or failure, e.g. INSUFFICIENT_CREDITS.
    failureCode: text("failure_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (table) => [
    check("sagas_state_check", sql`${table.state} in (${stateList})`),
    check("sagas_amount_check", sql`${table.amount} > 0`),
    index("sagas_reserving_deadline_idx").on(table.reserveDeadline).where(sql`${table.state} = 'RESERVING'`),
  ],
);

// Event ids already handled, so redelivered events change nothing.
export const processedMessages = pgTable("processed_messages", {
  messageId: text("message_id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow().notNull(),
});

// Commands written in the same transaction as the saga step, then published by the relay.
export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    topic: text("topic").notNull(),
    orderingKey: text("ordering_key").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [index("outbox_unpublished_idx").on(table.createdAt).where(sql`${table.publishedAt} is null`)],
);
