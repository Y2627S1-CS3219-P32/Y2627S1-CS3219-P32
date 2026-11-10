import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { MandateApproved } from '../common/validation.js';

export const mandates = pgTable('mandates', {
  id: uuid('id').primaryKey(),
  userId: integer('user_id').notNull(),
  // Opaque caller-owned correlation key; Mandate Service does not interpret it.
  businessKeyId: text('business_key_id').notNull(),
  termsHash: text('terms_hash').notNull(),
  title: text('title').notNull().default('Order authorization'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  status: text('status', { enum: ['pending', 'active', 'paused', 'revoked', 'expired'] }).notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  approvalExpiresAt: timestamp('approval_expires_at', { withTimezone: true }).notNull().default(sql`now() + interval '1 hour'`),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, table => [
  unique().on(table.userId, table.businessKeyId),
  index('mandates_owner').on(table.userId, table.status),
  check('mandates_business_key_check', sql`length(trim(${table.businessKeyId})) > 0`),
  check('mandates_status_check', sql`${table.status} IN ('pending','active','paused','revoked','expired')`),
  check('mandates_validity_check', sql`${table.expiresAt} > ${table.startsAt}`),
  check('mandates_expiry_check', sql`${table.approvedAt} IS NULL OR ${table.expiresAt} > ${table.approvedAt}`),
  check('mandates_approval_check', sql`${table.status} NOT IN ('active', 'paused') OR ${table.approvedAt} IS NOT NULL`),
]);

export const mandateConstraints = pgTable('mandate_constraints', {
  mandateId: uuid('mandate_id').notNull().references(() => mandates.id, { onDelete: 'cascade' }),
  constraintType: text('constraint_type', { enum: ['supplier_id', 'max_credit_amount'] }).notNull(),
  // Supplier IDs stay opaque; amount values use canonical nonnegative integer strings.
  value: text('value').notNull(),
}, table => [
  primaryKey({ name: 'mandate_constraints_pk', columns: [table.mandateId, table.constraintType, table.value] }),
  uniqueIndex('mandate_constraints_one_amount').on(table.mandateId).where(sql`${table.constraintType} = 'max_credit_amount'`),
  check('mandate_constraints_type_check', sql`${table.constraintType} IN ('supplier_id', 'max_credit_amount')`),
  check('mandate_constraints_value_check', sql`length(trim(${table.value})) > 0`),
  check('mandate_constraints_amount_check', sql`CASE WHEN ${table.constraintType} = 'max_credit_amount' THEN
    CASE WHEN ${table.value} ~ '^(0|[1-9][0-9]{0,15})$' THEN ${table.value}::numeric <= 9007199254740991 ELSE false END
    ELSE true END`),
]);

export const mandateOutbox = pgTable('mandate_outbox', {
  eventId: uuid('event_id').primaryKey(),
  mandateId: uuid('mandate_id').notNull().references(() => mandates.id),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').$type<MandateApproved>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
}, table => [index('mandate_outbox_unpublished').on(table.createdAt).where(sql`${table.publishedAt} IS NULL`)]);
