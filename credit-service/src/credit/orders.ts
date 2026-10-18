import type { Transaction } from "../db/index.js";
import { creditOrders } from "../db/schema.js";
import type { Outcome } from "./types.js";

export async function saveOrder(
  client: Transaction,
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
  await client.insert(creditOrders).values({
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
