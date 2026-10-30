import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { PubSub } from "@google-cloud/pubsub";
import pg from "pg";
const userId = Number(process.env.CREDIT_PROOF_USER_ID);
assert.ok(Number.isInteger(userId) && userId > 0);
const mode = process.argv[2];
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const pubsub = new PubSub({ projectId: process.env.PUBSUB_PROJECT_ID });
const content = [
  { alg: "HS256", typ: "JWT" },
  { sub: String(userId), exp: Math.floor(Date.now() / 1000) + 600 },
]
  .map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
  .join(".");
const jwt = `${content}.${createHmac("sha256", process.env.JWT_SECRET).update(content).digest("base64url")}`;
const base = `http://127.0.0.1:${process.env.PORT ?? 3000}`;
const balance = async () => {
  const response = await fetch(`${base}/api/v1/credits/me`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
  return { status: response.status, value: await response.json() };
};
try {
  if (mode === "prepare") {
    await pubsub
      .topic(process.env.USER_EVENTS_TOPIC ?? "user-events")
      .publishMessage({
        json: {
          eventId: randomUUID(),
          type: "user.created",
          user: { id: userId },
        },
      });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await balance()).status === 200) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(ready, "Pub/Sub provisioned Compose account");
    const requestId = randomUUID();
    const command = {
      type: "credit.reserve",
      requestId,
      correlationId: randomUUID(),
      orderId: randomUUID(),
      requesterId: userId,
      amount: 120,
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
          [requestId],
        )
      ).rows[0]?.result;
      if (result) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.equal(result?.applied, true);
  } else assert.equal(mode, "verify");
  const actual = await balance();
  assert.equal(actual.status, 200);
  assert.deepEqual(actual.value, {
    totalCredits: 1000,
    reservedCredits: 120,
    availableCredits: 880,
  });
  const {
    rows: [evidence],
  } = await pool.query(
    "SELECT (SELECT count(*)::int FROM credit_orders WHERE user_id=$1) AS orders,(SELECT count(*)::int FROM credit_transactions WHERE credit_user_id=$1) AS movements",
    [userId],
  );
  assert.deepEqual(evidence, { orders: 2, movements: 2 });
  console.log(
    JSON.stringify({
      check: mode,
      userId,
      balance: actual.value,
      ...evidence,
      result: "PASS",
    }),
  );
} finally {
  await pubsub.close();
  await pool.end();
}
