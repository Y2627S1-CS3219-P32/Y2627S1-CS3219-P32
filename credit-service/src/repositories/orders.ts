import { and, eq, sql } from "drizzle-orm";
import type { Transaction } from "../db/index.js";
import { creditOrders, creditTransactions } from "../db/schema.js";
import type { Kind, Outcome } from "../common/types.js";

export async function findPriorOrder(
  tx: Transaction,
  requestId: string,
) {
  const [order] = await tx
    .select({
      orderId: creditOrders.order_id,
      result: creditOrders.result,
    })
    .from(creditOrders)
    .where(eq(creditOrders.request_id, requestId));
  return order;
}

export async function findOrder(tx: Transaction, requestId: string) {
  const [order] = await tx
    .select()
    .from(creditOrders)
    .where(eq(creditOrders.request_id, requestId));
  return order;
}

export async function findAppliedOperation(
  tx: Transaction,
  orderId: string,
  kind: Kind,
) {
  const [order] = await tx
    .select({ result: creditOrders.result })
    .from(creditOrders)
    .where(
      and(
        eq(creditOrders.order_id, orderId),
        eq(creditOrders.kind, kind),
        eq(creditOrders.status, "SUCCEEDED"),
        sql`${creditOrders.result}->>'applied' = 'true'`,
      ),
    )
    .limit(1);
  return order?.result;
}

export async function findSuccessfulOperation(
  tx: Transaction,
  orderId: string,
  kind: Kind,
) {
  const [order] = await tx
    .select({ result: creditOrders.result })
    .from(creditOrders)
    .where(
      and(
        eq(creditOrders.order_id, orderId),
        eq(creditOrders.kind, kind),
        eq(creditOrders.status, "SUCCEEDED"),
      ),
    )
    .limit(1);
  return order?.result;
}

export async function hasAllocation(tx: Transaction, id: number) {
  const [allocation] = await tx
    .select({ user_id: creditOrders.user_id })
    .from(creditOrders)
    .where(
      and(
        eq(creditOrders.user_id, id),
        eq(creditOrders.kind, "ALLOCATE"),
        eq(creditOrders.status, "SUCCEEDED"),
      ),
    )
    .limit(1);
  return allocation !== undefined;
}

export async function saveOrder(
  tx: Transaction,
  data: {
    requestId: string;
    kind: typeof creditOrders.$inferInsert.kind;
    payload: typeof creditOrders.$inferInsert.request_payload;
    orderId?: string;
    userId: number;
    correlationId: string;
    result: Outcome;
    grant?: bigint;
  },
) {
  await tx.insert(creditOrders).values({
    request_id: data.requestId,
    kind: data.kind,
    initial_grant: data.grant ?? null,
    request_payload: data.payload,
    order_id: data.orderId ?? null,
    user_id: data.userId,
    status: data.result.status,
    result: data.result,
    correlation_id: data.correlationId,
  });
}

export async function saveMovement(
  tx: Transaction,
  data: {
    transactionId: string;
    requestId: string;
    debitUserId?: number;
    creditUserId: number;
    debitBucket: "AVAILABLE" | "RESERVED" | "ISSUANCE";
    creditBucket: "AVAILABLE" | "RESERVED";
    amount: bigint;
  },
) {
  await tx.insert(creditTransactions).values({
    transaction_id: data.transactionId,
    credit_order_request_id: data.requestId,
    debit_user_id: data.debitUserId,
    credit_user_id: data.creditUserId,
    debit_bucket: data.debitBucket,
    credit_bucket: data.creditBucket,
    amount: data.amount,
  });
}
