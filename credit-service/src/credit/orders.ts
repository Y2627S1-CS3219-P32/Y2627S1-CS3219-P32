import type pg from "pg";
import type { Outcome } from "./types.js";

export async function saveOrder(
  client: pg.PoolClient,
  data: {
    requestId: string;
    kind: string;
    payload: unknown;
    orderId?: string;
    userId: number;
    correlationId: string;
    result: Outcome;
    grant?: bigint;
  },
) {
  await client.query(
    "INSERT INTO credit_orders(request_id,kind,initial_grant,request_payload,order_id,user_id,status,result,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      data.requestId,
      data.kind,
      data.grant?.toString() ?? null,
      JSON.stringify(data.payload),
      data.orderId ?? null,
      data.userId,
      data.result.status,
      JSON.stringify(data.result),
      data.correlationId,
    ],
  );
}
