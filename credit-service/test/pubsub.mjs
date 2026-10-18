import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PubSub } from "@google-cloud/pubsub";
import { createApp } from "../dist/app.js";
import { getBalance as balance } from "../dist/services/reads.js";
import { pool } from "../dist/db/index.js";
import { publishBatch } from "../dist/outbox-publisher/publisher.js";

const projectId = process.env.PUBSUB_PROJECT_ID ?? "foc-local";
const pubsub = new PubSub({ projectId });
const topic = pubsub.topic(process.env.CREDIT_EVENTS_TOPIC ?? "credit-events", {
  messageOrdering: true,
});
const commands = pubsub.topic(
  process.env.CREDIT_COMMANDS_TOPIC ?? "credit-commands",
  { messageOrdering: true },
);
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
const deliveries = [];
const server = createApp().listen(Number(process.env.PORT ?? 3004), "0.0.0.0");
server.on("request", (request, response) => {
  response.once("finish", () => {
    const data = request.body?.message?.data;
    if (request.url.split("?")[0] !== "/internal/pubsub/credit-commands" || !data) return;
    const command = JSON.parse(Buffer.from(data, "base64").toString());
    deliveries.push({ requestId: command.requestId, status: response.statusCode });
  });
});
await new Promise((resolve) => server.once("listening", resolve));
const directory = await mkdtemp(join(tmpdir(), "credit-command-proof-"));
const userId = 100000 + Math.floor(Math.random() * 1000000000);
const sourceId = randomUUID();
const wait = async (check, label) => {
  for (let i = 0; i < 150; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out ${label}`);
};
const publish = (command) =>
  commands.publishMessage({
    json: command,
    orderingKey: command.orderId,
    attributes: { type: command.type },
  });
const outcome = async (command, cli = false) => {
  const before = deliveries.filter(
    (item) => item.requestId === command.requestId && item.status === 204,
  ).length;
  if (cli) {
    const file = join(directory, "command.json");
    await writeFile(file, JSON.stringify(command));
    const { stdout } = await promisify(execFile)(process.execPath, [
      "dist/scripts/send-command.js",
      file,
    ]);
    const accepted = JSON.parse(stdout);
    assert.equal(accepted.requestId, command.requestId);
    assert.equal(accepted.correlationId, command.correlationId);
    assert.ok(accepted.messageId);
  } else await publish(command);
  await wait(
    () =>
      deliveries.filter((item) => item.requestId === command.requestId && item.status === 204).length >
      before,
    "command push commit",
  );
  await publishBatch(topic);
  await wait(
    () => received.some((event) => event.requestId === command.requestId),
    "command outcome delivery",
  );
  const event = received.find((item) => item.requestId === command.requestId);
  assert.equal(event.correlationId, command.correlationId);
  return event.data;
};
const provision = async (id, eventId = randomUUID()) => {
  await pubsub
    .topic(process.env.USER_EVENTS_TOPIC ?? "user-events")
    .publishMessage({
      json: { eventId, type: "user.created", user: { id }, version: 99 },
    });
  await wait(
    async () =>
      !!(
        await pool.query("SELECT 1 FROM credit_accounts WHERE user_id=$1", [id])
      ).rowCount,
    "user push provisioning",
  );
};
try {
  for (const [name, path] of [
    [
      process.env.USER_EVENTS_SUBSCRIPTION ?? "credit-service-user-events",
      "/internal/pubsub/user-events",
    ],
    [
      process.env.CREDIT_COMMANDS_SUBSCRIPTION ?? "credit-service-commands",
      "/internal/pubsub/credit-commands",
    ],
  ]) {
    const [metadata] = await pubsub.subscription(name).getMetadata();
    assert.ok(metadata.pushConfig.pushEndpoint.includes(path));
  }
  await provision(userId, sourceId);
  const courierId = userId + 1;
  await provision(courierId);
  assert.equal((await balance(userId)).totalCredits, 1000);
  console.log(
    "PASS durable user and command subscriptions with authenticated account provisioning",
  );

  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, headers = {}) => {
    const response = await fetch(base + path, {
      headers: {
        "x-internal-secret": process.env.INTERNAL_SHARED_SECRET,
        ...headers,
      },
    });
    return { status: response.status, body: await response.json() };
  };
  const tokenBody = [
    { alg: "HS256", typ: "JWT" },
    { sub: String(userId), exp: Math.floor(Date.now() / 1000) + 300 },
  ]
    .map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
    .join(".");
  const token = `${tokenBody}.${createHmac("sha256", process.env.JWT_SECRET).update(tokenBody).digest("base64url")}`;
  assert.equal(
    (await request("/api/v1/credits/me", { authorization: `Bearer ${token}` }))
      .body.totalCredits,
    1000,
  );

  const reserve = {
    type: "credit.reserve",
    requestId: randomUUID(),
    correlationId: randomUUID(),
    orderId: randomUUID(),
    requesterId: userId,
    amount: 120,
  };
  const reserved = await outcome(reserve, true);
  assert.equal(reserved.reservationState, "HELD");
  assert.equal(reserved.applied, true);
  const beforeReplay = (
    await pool.query("SELECT count(*) FROM credit_outbox WHERE request_id=$1", [
      reserve.requestId,
    ])
  ).rows[0].count;
  assert.deepEqual(await outcome(reserve), reserved);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM credit_outbox WHERE request_id=$1",
        [reserve.requestId],
      )
    ).rows[0].count,
    beforeReplay,
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
  const rejected = await outcome({
    ...reserve,
    requestId: randomUUID(),
    orderId: randomUUID(),
    amount: 1001,
  });
  assert.equal(rejected.code, "INSUFFICIENT_CREDITS");
  assert.equal(rejected.status, "REJECTED");
  const transfer = {
    type: "credit.transfer",
    requestId: randomUUID(),
    correlationId: randomUUID(),
    orderId: reserve.orderId,
    courierId,
  };
  assert.equal(
    (await outcome({ ...transfer, requestId: randomUUID(), courierId: userId }))
      .code,
    "SELF_TRANSFER",
  );
  assert.equal((await outcome(transfer)).reservationState, "TRANSFERRED");
  const releaseReserve = {
    ...reserve,
    requestId: randomUUID(),
    orderId: randomUUID(),
  };
  await outcome(releaseReserve);
  assert.equal(
    (
      await outcome({
        ...releaseReserve,
        type: "credit.release",
        requestId: randomUUID(),
        reason: "cancelled",
      })
    ).reservationState,
    "RELEASED",
  );
  assert.equal((await balance(userId)).totalCredits, 880);
  assert.equal((await balance(userId)).reservedCredits, 0);
  assert.equal((await balance(courierId)).totalCredits, 1120);
  console.log(
    "PASS CLI and Pub/Sub reserve, duplicate replay, rejection, transfer, release, correlated outcomes, and HTTP reads",
  );

  for (const path of [
    "/internal/v1/credit-reservations",
    `/internal/v1/credit-reservations/${reserve.orderId}/transfer`,
    `/internal/v1/credit-reservations/${reserve.orderId}/release`,
  ]) {
    const response = await fetch(base + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": process.env.INTERNAL_SHARED_SECRET,
      },
      body: JSON.stringify(reserve),
    });
    assert.equal(response.status, 404);
  }
  for (const path of [
    "/internal/pubsub/user-events",
    "/internal/pubsub/credit-commands",
  ]) {
    const response = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: { data: Buffer.from("{}").toString("base64") },
      }),
    });
    assert.equal(response.status, 401);
  }
  console.log(
    "PASS legacy HTTP mutations removed and forged Pub/Sub push rejected",
  );

  const pendingUser = userId + 2;
  const pending = {
    ...reserve,
    requesterId: pendingUser,
    requestId: randomUUID(),
    correlationId: randomUUID(),
    orderId: randomUUID(),
    amount: 10,
  };
  await publish(pending);
  await wait(
    () =>
      deliveries.some(
        (item) => item.requestId === pending.requestId && item.status === 503,
      ),
    "pending-account negative acknowledgment",
  );
  assert.equal(
    (
      await pool.query("SELECT 1 FROM credit_orders WHERE request_id=$1", [
        pending.requestId,
      ])
    ).rowCount,
    0,
  );
  await provision(pendingUser);
  await wait(
    () => deliveries.some((item) => item.requestId === pending.requestId && item.status === 204),
    "pending command redelivery",
  );
  await publishBatch(topic);
  await wait(
    () => received.some((event) => event.requestId === pending.requestId),
    "retried reserve outcome",
  );
  assert.equal((await balance(pendingUser)).reservedCredits, 10);

  const earlyTransfer = {
    ...transfer,
    requestId: randomUUID(),
    correlationId: randomUUID(),
    orderId: randomUUID(),
  };
  await publish(earlyTransfer);
  await wait(
    () =>
      deliveries.some(
        (item) => item.requestId === earlyTransfer.requestId && item.status === 503,
      ),
    "early-transfer negative acknowledgment",
  );
  assert.equal(
    (await pool.query("SELECT 1 FROM credit_orders WHERE request_id=$1", [earlyTransfer.requestId])).rowCount,
    0,
  );
  await outcome({
    ...reserve,
    requestId: randomUUID(),
    correlationId: earlyTransfer.correlationId,
    orderId: earlyTransfer.orderId,
    amount: 25,
  });
  await wait(
    () => deliveries.some((item) => item.requestId === earlyTransfer.requestId && item.status === 204),
    "early transfer redelivery",
  );
  await publishBatch(topic);
  await wait(
    () => received.some((event) => event.requestId === earlyTransfer.requestId),
    "retried transfer outcome",
  );
  assert.equal((await balance(userId)).totalCredits, 855);
  assert.equal((await balance(courierId)).totalCredits, 1145);
  console.log(
    "PASS broker retries pending accounts and transfer-before-reserve without prematurely saving outcomes",
  );

  const cancellation = {
    ...reserve,
    type: "credit.release",
    requestId: randomUUID(),
    correlationId: randomUUID(),
    orderId: randomUUID(),
    amount: 10,
    reason: "cancel before reserve",
  };
  assert.equal((await outcome(cancellation)).reservationState, "CANCELLED");
  assert.equal(
    (
      await outcome({
        ...cancellation,
        type: "credit.reserve",
        requestId: randomUUID(),
      })
    ).code,
    "RESERVATION_CANCELLED",
  );
  await pubsub
    .topic(process.env.USER_EVENTS_TOPIC ?? "user-events")
    .publishMessage({
      json: {
        eventId: randomUUID(),
        type: "user.deleted",
        userId: pendingUser,
      },
    });
  await wait(
    async () =>
      (
        await pool.query(
          "SELECT deleted_at FROM credit_accounts WHERE user_id=$1",
          [pendingUser],
        )
      ).rows[0]?.deleted_at,
    "user deletion",
  );
  const inactive = await outcome({
    ...pending,
    requestId: randomUUID(),
    orderId: randomUUID(),
  });
  assert.equal(inactive.status, "REJECTED");
  assert.equal(inactive.code, "USER_INACTIVE");
  console.log(
    "PASS cancellation blocks late reserve and inactive commands publish durable rejection outcomes",
  );

  const command = {
    ...reserve,
    requestId: randomUUID(),
    correlationId: randomUUID(),
    orderId: randomUUID(),
  };
  await publish(command);
  await wait(
    () => deliveries.some((item) => item.requestId === command.requestId),
    "outbox outage setup",
  );
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
    type: "credit.release",
    requestId: randomUUID(),
    reason: "cancel",
  };
  await publish(release);
  await wait(
    () => deliveries.some((item) => item.requestId === release.requestId),
    "outbox replay release setup",
  );
  await publishBatch({
    publishMessage: async (message) => {
      await topic.publishMessage(message);
      throw new Error("simulated crash after broker acknowledgment");
    },
    resumePublishing: (orderingKey) => topic.resumePublishing(orderingKey),
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
  await wait(
    () => received.some((event) => event.requestId === release.requestId),
    "later same-key release delivery",
  );
  assert.ok(
    (
      await pool.query(
        "SELECT published_at FROM credit_outbox WHERE request_id=$1",
        [command.requestId],
      )
    ).rows[0].published_at,
  );
  assert.deepEqual(
    received
      .filter((event) => event.orderId === command.orderId)
      .map((event) => event.type),
    ["credit.reserved", "credit.reserved", "credit.released"],
  );
  assert.ok(
    received.every(
      (event) =>
        !("schemaVersion" in event) && !("reservationVersion" in event),
    ),
  );
  console.log(
    "PASS publish-before-mark recovery redelivered stable event IDs before later same-order outcomes",
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  await subscription.close();
  await pubsub.subscription(subscriptionName).delete();
  await pubsub.close();
  await pool.end();
  await rm(directory, { recursive: true, force: true });
}
