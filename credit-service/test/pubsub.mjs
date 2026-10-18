import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { PubSub } from "@google-cloud/pubsub";
import { createApp } from "../dist/app.js";
import { execute } from "../dist/credit/commands.js";
import { userEvent } from "../dist/credit/accounts.js";
import { balance, reservation, lookup } from "../dist/credit/queries.js";
import { pool } from "../dist/db/index.js";
import { publishBatch } from "../dist/events/publisher.js";
const projectId = process.env.PUBSUB_PROJECT_ID ?? "foc-local";
const pubsub = new PubSub({ projectId });
const topic = pubsub.topic(process.env.CREDIT_EVENTS_TOPIC ?? "credit-events", {
  messageOrdering: true,
});
const subscriptionName = `credit-proof-${randomUUID()}`;
const [subscription] = await topic.createSubscription(subscriptionName, {
  enableMessageOrdering: true,
});
const received = [];
subscription.on("message", (message) => {
  received.push(JSON.parse(message.data.toString()));
  message.ack();
});
subscription.on("error", (error) => console.error(error.message));
const server = createApp({
  execute,
  userEvent,
  balance,
  reservation,
  lookup,
}).listen(
  Number(process.env.PORT ?? 3004),
  "0.0.0.0",
);
await new Promise((resolve) => server.once("listening", resolve));
const userId = 100000 + Math.floor(Math.random() * 1000000000);
const sourceId = randomUUID();
const wait = async (check, label) => {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out ${label}`);
};
try {
  const [metadata] = await pubsub
    .subscription(
      process.env.USER_EVENTS_SUBSCRIPTION ?? "credit-service-user-events",
    )
    .getMetadata();
  assert.ok(
    metadata.pushConfig.pushEndpoint.includes("/internal/pubsub/user-events"),
  );
  console.log(
    "PASS durable subscription exists with authenticated push endpoint",
  );
  await pubsub
    .topic(process.env.USER_EVENTS_TOPIC ?? "user-events")
    .publishMessage({
      json: {
        eventId: sourceId,
        type: "user.created",
        user: { id: userId },
        version: 99,
      },
    });
  await wait(
    async () =>
      !!(
        await pool.query("SELECT 1 FROM credit_accounts WHERE user_id=$1", [
          userId,
        ])
      ).rowCount,
    "authenticated push provisioning",
  );
  assert.equal((await balance(userId)).totalCredits, 1000);
  console.log(
    `PASS Pub/Sub push provisioned account ${userId} with 1000 credits`,
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, body, headers = {}) => {
    const response = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": process.env.INTERNAL_SHARED_SECRET,
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  const tokenBody = [
    { alg: "HS256", typ: "JWT" },
    { sub: String(userId), exp: Math.floor(Date.now() / 1000) + 300 },
  ]
    .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
    .join(".");
  const token =
    tokenBody +
    "." +
    createHmac("sha256", process.env.JWT_SECRET)
      .update(tokenBody)
      .digest("base64url");
  assert.equal(
    (
      await request("/api/v1/credits/me", undefined, {
        authorization: `Bearer ${token}`,
      })
    ).body.totalCredits,
    1000,
  );
  const courierId = userId + 1;
  await pubsub
    .topic(process.env.USER_EVENTS_TOPIC ?? "user-events")
    .publishMessage({
      json: {
        eventId: randomUUID(),
        type: "user.created",
        user: { id: courierId },
      },
    });
  await wait(
    async () =>
      !!(
        await pool.query("SELECT 1 FROM credit_accounts WHERE user_id=$1", [
          courierId,
        ])
      ).rowCount,
    "courier provisioning",
  );
  const reserve = {
    requestId: randomUUID(),
    correlationId: randomUUID(),
    orderId: randomUUID(),
    requesterId: userId,
    amount: 120,
  };
  const reserved = await request("/internal/v1/credit-reservations", reserve);
  assert.equal(reserved.status, 200);
  assert.deepEqual(
    await request("/internal/v1/credit-reservations", reserve),
    reserved,
  );
  assert.equal(
    (await request("/internal/v1/credit-orders/" + reserve.requestId)).status,
    200,
  );
  assert.equal(
    (await request("/internal/v1/credit-reservations/" + reserve.orderId)).body
      .reservationState,
    "HELD",
  );
  assert.equal(
    (
      await request("/internal/v1/credit-reservations", {
        ...reserve,
        requestId: randomUUID(),
        orderId: randomUUID(),
        amount: 1001,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("/internal/v1/credit-reservations", {
        ...reserve,
        requestId: randomUUID(),
        amount: 1.5,
      })
    ).status,
    400,
  );
  const transfer = {
    requestId: randomUUID(),
    correlationId: randomUUID(),
    courierId,
  };
  assert.equal(
    (
      await request(
        `/internal/v1/credit-reservations/${reserve.orderId}/transfer`,
        { ...transfer, courierId: userId },
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        `/internal/v1/credit-reservations/${reserve.orderId}/transfer`,
        { ...transfer, requestId: randomUUID() },
      )
    ).status,
    200,
  );
  const releaseReserve = {
    ...reserve,
    requestId: randomUUID(),
    orderId: randomUUID(),
  };
  assert.equal(
    (await request("/internal/v1/credit-reservations", releaseReserve)).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/internal/v1/credit-reservations/${releaseReserve.orderId}/release`,
        {
          requestId: randomUUID(),
          correlationId: randomUUID(),
          requesterId: userId,
          amount: 120,
          reason: "cancelled",
        },
      )
    ).status,
    200,
  );
  assert.equal((await balance(userId)).totalCredits, 880);
  assert.equal((await balance(courierId)).totalCredits, 1120);
  const forged = await fetch(base + "/internal/pubsub/user-events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: { data: Buffer.from("{}").toString("base64") },
    }),
  });
  assert.equal(forged.status, 401);
  console.log(
    "PASS HTTP owner balance, reserve, replay, rejection, transfer, release, lookups, amount/auth checks; requester=880 courier=1120",
  );
  await publishBatch(topic);
  await wait(
    () => received.some((event) => event.requestId === sourceId),
    "allocation delivery",
  );
  const command = {
    kind: "RESERVE",
    requestId: randomUUID(),
    correlationId: randomUUID(),
    orderId: randomUUID(),
    requesterId: userId,
    amount: 120,
  };
  await execute(command);
  const originalHost = process.env.PUBSUB_EMULATOR_HOST;
  process.env.PUBSUB_EMULATOR_HOST = "127.0.0.1:1";
  const outageClient = new PubSub({ projectId });
  process.env.PUBSUB_EMULATOR_HOST = originalHost;
  const outageTopic = outageClient.topic(
    process.env.CREDIT_EVENTS_TOPIC ?? "credit-events",
    { messageOrdering: true, gaxOpts: { timeout: 300, retry: null } },
  );
  await publishBatch(outageTopic);
  await outageClient.close();
  assert.equal(
    (
      await pool.query(
        "SELECT published_at FROM credit_outbox WHERE request_id=$1",
        [command.requestId],
      )
    ).rows[0].published_at,
    null,
  );
  assert.equal((await balance(userId)).reservedCredits, 120);
  console.log(
    "PASS broker outage retained committed reservation and unpublished outbox",
  );
  const release = {
    ...command,
    kind: "RELEASE",
    requestId: randomUUID(),
    reason: "cancel",
  };
  await execute(release);
  await publishBatch(topic, async () => {
    throw new Error("simulated crash after broker acknowledgment");
  });
  await wait(
    () => received.some((event) => event.requestId === command.requestId),
    "first reserve delivery",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT published_at FROM credit_outbox WHERE request_id=$1",
        [release.requestId],
      )
    ).rows[0].published_at,
    null,
  );
  assert.equal(
    received.some((event) => event.requestId === release.requestId),
    false,
  );
  const eventId = received.find(
    (event) => event.requestId === command.requestId,
  ).eventId;
  await publishBatch(topic);
  await wait(
    () => received.filter((event) => event.eventId === eventId).length >= 2,
    "stable event replay",
  );
  assert.ok(
    (
      await pool.query(
        "SELECT published_at FROM credit_outbox WHERE request_id=$1",
        [command.requestId],
      )
    ).rows[0].published_at,
  );
  console.log(
    `PASS publish-before-mark recovery redelivered stable eventId ${eventId}`,
  );
  await wait(
    () => received.some((event) => event.requestId === release.requestId),
    "later same-key release delivery",
  );
  const sameKey = received.filter((event) => event.orderId === command.orderId);
  assert.deepEqual(
    sameKey.map((event) => event.type),
    ["credit.reserved", "credit.reserved", "credit.released"],
  );
  console.log(
    "PASS later same-key outcome stayed behind failed publication and replay",
  );
  assert.ok(
    received.every(
      (event) =>
        !("schemaVersion" in event) && !("reservationVersion" in event),
    ),
  );
  console.log("PASS stored outcome envelopes contain no version fields");
} finally {
  await new Promise((resolve) => server.close(resolve));
  await subscription.close();
  await pubsub.subscription(subscriptionName).delete();
  await pubsub.close();
  await pool.end();
}
