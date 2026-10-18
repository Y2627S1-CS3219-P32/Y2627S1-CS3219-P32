import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { PubSub } from "@google-cloud/pubsub";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const pubsub = new PubSub({ projectId: process.env.PUBSUB_PROJECT_ID });
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
    const command = {
      type: "credit.release",
      requestId: randomUUID(),
      correlationId: randomUUID(),
      orderId: reserve.order_id,
      requesterId: userId,
      amount: reserve.request_payload.amount,
      reason: "broker outage proof",
    };
    await pubsub
      .topic(process.env.CREDIT_COMMANDS_TOPIC ?? "credit-commands")
      .publishMessage({
        json: command,
        orderingKey: command.orderId,
        attributes: { type: command.type },
      });
    let result;
    for (let attempt = 0; attempt < 100; attempt++) {
      result = (
        await pool.query(
          "SELECT result FROM credit_orders WHERE request_id=$1",
          [command.requestId],
        )
      ).rows[0]?.result;
      if (result) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.equal(result?.applied, true);
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
  await pubsub.close();
  await pool.end();
}
