import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  OPERATION_KIND,
  type operationPayload,
  type Outcome,
  type OutcomeEvent,
} from '../common/types.js';

export const creditAccounts = pgTable(
  'credit_accounts',
  {
    user_id: integer().primaryKey(),
    total_credits: bigint({ mode: 'bigint' }).notNull(),
    reserved_credits: bigint({ mode: 'bigint' }).notNull(),
    deleted_at: timestamp({ withTimezone: true }),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check('credit_accounts_user_id_check', sql`${t.user_id} > 0`),
    check(
      'credit_accounts_total_credits_check',
      sql`${t.total_credits} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      'credit_accounts_check',
      sql`${t.reserved_credits} BETWEEN 0 AND ${t.total_credits}`,
    ),
  ],
);

export const creditOrders = pgTable(
  'credit_orders',
  {
    request_id: uuid().primaryKey(),
    kind: text({
      enum: [
        'ALLOCATE',
        OPERATION_KIND.RESERVE,
        OPERATION_KIND.TRANSFER,
        OPERATION_KIND.RELEASE,
      ],
    }).notNull(),
    initial_grant: bigint({ mode: 'bigint' }),
    request_payload: jsonb()
      .$type<ReturnType<typeof operationPayload> | { userId: number }>()
      .notNull(),
    order_id: uuid(),
    user_id: integer().notNull(),
    status: text({ enum: ['SUCCEEDED', 'REJECTED'] }).notNull(),
    result: jsonb().$type<Outcome>().notNull(),
    correlation_id: uuid().notNull(),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.user_id],
      foreignColumns: [creditAccounts.user_id],
      name: 'credit_orders_user_id_fkey',
    }),
    check(
      'credit_orders_kind_check',
      sql`${t.kind} IN ('ALLOCATE','RESERVE','TRANSFER','RELEASE')`,
    ),
    check(
      'credit_orders_initial_grant_check',
      sql`${t.initial_grant} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      'credit_orders_status_check',
      sql`${t.status} IN ('SUCCEEDED','REJECTED')`,
    ),
    check(
      'credit_orders_check',
      sql`(${t.kind} = 'ALLOCATE' AND ${t.initial_grant} IS NOT NULL AND ${t.order_id} IS NULL) OR (${t.kind} <> 'ALLOCATE' AND ${t.initial_grant} IS NULL AND ${t.order_id} IS NOT NULL)`,
    ),
    uniqueIndex('credit_one_allocation')
      .on(t.user_id)
      .where(sql`${t.kind} = 'ALLOCATE' AND ${t.status} = 'SUCCEEDED'`),
    uniqueIndex('credit_one_movement')
      .on(t.order_id, t.kind)
      .where(
        sql`${t.status} = 'SUCCEEDED' AND ${t.result}->>'applied' = 'true'`,
      ),
    index('credit_history').on(t.order_id, t.kind, t.status),
  ],
);

export const creditTransactions = pgTable(
  'credit_transactions',
  {
    transaction_id: uuid().primaryKey(),
    credit_order_request_id: uuid()
      .notNull()
      .unique('credit_transactions_credit_order_request_id_key'),
    debit_user_id: integer(),
    credit_user_id: integer().notNull(),
    debit_bucket: text({
      enum: ['AVAILABLE', 'RESERVED', 'ISSUANCE'],
    }).notNull(),
    credit_bucket: text({ enum: ['AVAILABLE', 'RESERVED'] }).notNull(),
    amount: bigint({ mode: 'bigint' }).notNull(),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.credit_order_request_id],
      foreignColumns: [creditOrders.request_id],
      name: 'credit_transactions_credit_order_request_id_fkey',
    }),
    foreignKey({
      columns: [t.debit_user_id],
      foreignColumns: [creditAccounts.user_id],
      name: 'credit_transactions_debit_user_id_fkey',
    }),
    foreignKey({
      columns: [t.credit_user_id],
      foreignColumns: [creditAccounts.user_id],
      name: 'credit_transactions_credit_user_id_fkey',
    }),
    check(
      'credit_transactions_debit_bucket_check',
      sql`${t.debit_bucket} IN ('AVAILABLE','RESERVED','ISSUANCE')`,
    ),
    check(
      'credit_transactions_credit_bucket_check',
      sql`${t.credit_bucket} IN ('AVAILABLE','RESERVED')`,
    ),
    check(
      'credit_transactions_amount_check',
      sql`${t.amount} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      'credit_transactions_check',
      sql`(${t.debit_user_id} IS NULL) = (${t.debit_bucket} = 'ISSUANCE')`,
    ),
  ],
);

export const creditOutbox = pgTable(
  'credit_outbox',
  {
    event_id: uuid().primaryKey(),
    request_id: uuid().notNull().unique('credit_outbox_request_id_key'),
    payload: jsonb().$type<OutcomeEvent>().notNull(),
    created_at: timestamp({ withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
    published_at: timestamp({ withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.request_id],
      foreignColumns: [creditOrders.request_id],
      name: 'credit_outbox_request_id_fkey',
    }),
    index('credit_unpublished')
      .on(t.created_at)
      .where(sql`${t.published_at} IS NULL`),
  ],
);
