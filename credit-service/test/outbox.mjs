import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const userId = Number(process.env.CREDIT_PROOF_USER_ID);
const mode = process.argv[2];
try {
  if (mode === "release") {
    const {
      rows: [reserve],
    } = await pool.query(
      "SELECT order_id,request_payload FROM credit_orders WHERE user_id=$1 AND kind='RESERVE' AND result->>'applied'='true' ORDER BY created_at DESC LIMIT 1",
      [userId],
    );
    assert.ok(reserve);
    const response = await fetch(
      `http://127.0.0.1:${process.env.PORT ?? 3000}/internal/v1/credit-reservations/${reserve.order_id}/release`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-secret": process.env.INTERNAL_SHARED_SECRET,
        },
        body: JSON.stringify({
          requestId: randomUUID(),
          correlationId: randomUUID(),
          requesterId: userId,
          amount: reserve.request_payload.amount,
          reason: "broker outage proof",
        }),
      },
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).applied, true);
  } else assert.ok(["pending", "published"].includes(mode));
  const {
    rows: [row],
  } = await pool.query(
    "SELECT b.event_id,b.published_at FROM credit_outbox b JOIN credit_orders o USING(request_id) WHERE o.user_id=$1 AND o.kind='RELEASE' ORDER BY b.created_at DESC LIMIT 1",
    [userId],
  );
  assert.ok(row);
  if (mode === "published") assert.ok(row.published_at);
  else assert.equal(row.published_at, null);
  console.log(
    JSON.stringify({
      check: mode,
      userId,
      eventId: row.event_id,
      publishedAt: row.published_at,
      result: "PASS",
    }),
  );
} finally {
  await pool.end();
}
