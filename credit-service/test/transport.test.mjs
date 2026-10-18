import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createApp } from "../dist/app.js";
import { verifyAccessToken } from "../dist/auth.js";
const jwt = (payload, secret = "test-secret") => {
  const content = [{ alg: "HS256", typ: "JWT" }, payload]
    .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
    .join(".");
  return `${content}.${createHmac("sha256", secret).update(content).digest("base64url")}`;
};
test("JWT validates signature, header, expiry and integer string subject", () => {
  const good = jwt({ sub: "1", exp: 200 });
  assert.equal(verifyAccessToken(good, "test-secret", 100), 1);
  assert.equal(verifyAccessToken(good, "wrong", 100), undefined);
  for (const sub of [1, "0", "1.5", "2147483648"])
    assert.equal(
      verifyAccessToken(jwt({ sub, exp: 200 }), "test-secret", 100),
      undefined,
    );
  assert.equal(verifyAccessToken(good, "test-secret", 200), undefined);
});
test("HTTP rejects forged Pub/Sub delivery and unauthenticated balance reads", async () => {
  let calls = 0;
  const app = createApp({
    execute: async () => {
      calls++;
      return {};
    },
    userEvent: async () => {
      calls++;
    },
    balance: async () => ({}),
    reservation: async () => ({}),
    lookup: async () => ({}),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const path of [
      "/internal/pubsub/credit-commands",
      "/internal/pubsub/user-events",
    ]) {
      const res = await fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: randomUUID() }),
      });
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { code: "UNAUTHORIZED" });
    }
    assert.equal((await fetch(base + "/api/v1/credits/me")).status, 401);
    assert.equal(calls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

const { config } = await import("../dist/config.js");
const { parseCommand } = await import("../dist/events/commands.js");
const wire = (type = "credit.reserve", extra = {}) => ({
  type,
  requestId: randomUUID().toUpperCase(),
  correlationId: randomUUID().toUpperCase(),
  orderId: randomUUID().toUpperCase(),
  ...(type === "credit.transfer"
    ? { courierId: 2 }
    : { requesterId: 1, amount: 120 }),
  ...(type === "credit.release" ? { reason: "Cancelled by requester" } : {}),
  ...extra,
});
const envelope = (value) => ({
  message: { data: Buffer.from(JSON.stringify(value)).toString("base64") },
});
test("command parser validates explicit variants and normalizes UUIDs", () => {
  for (const type of ["credit.reserve", "credit.release", "credit.transfer"]) {
    const input = wire(type);
    const parsed = parseCommand(input);
    assert.equal(parsed.kind, type.split(".")[1].toUpperCase());
    for (const key of ["requestId", "correlationId", "orderId"])
      assert.equal(parsed[key], input[key].toLowerCase());
  }
  for (const value of [
    null,
    [],
    {},
    wire("credit.unknown"),
    wire(undefined, { orderId: "bad" }),
    ...[0, -1, 1.5, "120", 2147483648].map((amount) =>
      wire(undefined, { amount }),
    ),
    wire(undefined, { requesterId: 0 }),
    wire("credit.transfer", { courierId: 0 }),
    ...[undefined, " ", "x".repeat(201)].map((reason) =>
      wire("credit.release", { reason }),
    ),
  ])
    assert.throws(() => parseCommand(value), { code: "INVALID_COMMAND" });
  assert.equal(
    parseCommand(wire(undefined, { amount: 2147483647 })).amount,
    2147483647,
  );
  assert.equal(
    parseCommand(wire("credit.release", { reason: "x".repeat(200) })).reason
      .length,
    200,
  );
});
test("Pub/Sub commands acknowledge completed outcomes and retry thrown failures", async () => {
  const oldSecret = config.internalSharedSecret;
  const oldJwt = config.jwtSecret;
  config.internalSharedSecret = "transport-test";
  config.jwtSecret = "test-secret";
  let calls = 0,
    received,
    complete;
  let run = async (command) => {
    received = command;
    return { status: "SUCCEEDED" };
  };
  const app = createApp({
    execute: async (command) => {
      calls++;
      return run(command);
    },
    userEvent: async () => {},
    balance: async (id) => ({ userId: id }),
    reservation: async () => ({ reservationState: "HELD" }),
    lookup: async () => ({}),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, authenticated = true) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authenticated ? { "x-internal-secret": "transport-test" } : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    for (const type of [
      "credit.reserve",
      "credit.release",
      "credit.transfer",
    ]) {
      const value = wire(type);
      assert.equal(
        (await post("/internal/pubsub/credit-commands", envelope(value)))
          .status,
        204,
      );
      assert.deepEqual(received, parseCommand(value));
    }
    const { CreditError } = await import("../dist/credit/types.js");
    for (const [status, code] of [
      [503, "ACCOUNT_PENDING"],
      [503, "RESERVATION_NOT_READY"],
      [409, "IDEMPOTENCY_CONFLICT"],
    ]) {
      run = async () => {
        throw new CreditError(status, code);
      };
      const res = await post(
        "/internal/pubsub/credit-commands",
        envelope(wire()),
      );
      assert.equal(res.status, status);
      assert.deepEqual(await res.json(), { code });
    }
    run = async () => ({
      status: "REJECTED",
      code: "INSUFFICIENT_CREDITS",
      httpStatus: 409,
    });
    assert.equal(
      (await post("/internal/pubsub/credit-commands", envelope(wire()))).status,
      204,
    );
    let started;
    const entered = new Promise((resolve) => {
      started = resolve;
    });
    run = async () => {
      started();
      return new Promise((resolve) => {
        complete = resolve;
      });
    };
    let acknowledged = false;
    const pending = post(
      "/internal/pubsub/credit-commands",
      envelope(wire()),
    ).then((res) => {
      acknowledged = true;
      return res;
    });
    await entered;
    assert.equal(acknowledged, false);
    complete({ status: "SUCCEEDED" });
    assert.equal((await pending).status, 204);
    const priorCalls = calls;
    for (const body of [envelope({}), {}, { message: { data: "bad@@" } }])
      assert.equal(
        (await post("/internal/pubsub/credit-commands", body)).status,
        400,
      );
    assert.equal(
      (await post("/internal/pubsub/credit-commands", envelope(wire()), false))
        .status,
      401,
    );
    assert.equal(calls, priorCalls);
    for (const path of [
      "/internal/v1/credit-reservations",
      `/internal/v1/credit-reservations/${randomUUID()}/release`,
      `/internal/v1/credit-reservations/${randomUUID()}/transfer`,
    ])
      assert.equal((await post(path, wire())).status, 404);
    assert.equal(calls, priorCalls);
    const token = jwt({ sub: "1", exp: Math.floor(Date.now() / 1000) + 60 });
    const res = await fetch(base + "/api/v1/credits/me", {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { userId: 1 });
    assert.equal(
      (
        await fetch(base + `/internal/v1/credit-orders/${randomUUID()}`, {
          headers: { "x-internal-secret": "transport-test" },
        })
      ).status,
      200,
    );
  } finally {
    config.internalSharedSecret = oldSecret;
    config.jwtSecret = oldJwt;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Pub/Sub push authentication rejects diagnostic identities on alternate URLs", async () => {
  const { OAuth2Client } = await import("google-auth-library");
  const originalVerify = OAuth2Client.prototype.verifyIdToken;
  const settings = {
    internalAudience: config.internalAudience,
    internalInvokerEmails: config.internalInvokerEmails,
    pushInvokerEmail: config.pushInvokerEmail,
    internalSharedSecret: config.internalSharedSecret,
  };
  config.internalAudience = "credit-test-audience";
  config.internalInvokerEmails = ["diagnostic@example.test"];
  config.pushInvokerEmail = "pubsub@example.test";
  config.internalSharedSecret = undefined;
  OAuth2Client.prototype.verifyIdToken = async ({ idToken }) => ({
    getPayload: () => ({
      email:
        idToken === "push-token"
          ? "pubsub@example.test"
          : "diagnostic@example.test",
      email_verified: true,
    }),
  });
  let calls = 0;
  const server = createApp({
    execute: async () => {
      calls++;
      return { status: "SUCCEEDED" };
    },
    userEvent: async () => {
      calls++;
    },
    balance: async () => ({}),
    reservation: async () => ({}),
    lookup: async () => ({}),
  }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, token) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(envelope(wire())),
    });
  try {
    assert.equal(
      (
        await fetch(base + `/internal/v1/credit-orders/${randomUUID()}`, {
          headers: { authorization: "Bearer diagnostic-token" },
        })
      ).status,
      200,
    );
    for (const path of [
      "/internal/pubsub/credit-commands",
      "/internal/pubsub/credit-commands/",
      "/INTERNAL/PUBSUB/CREDIT-COMMANDS",
      "/internal/pubsub/user-events",
      "/internal/pubsub/user-events/",
      "/INTERNAL/PUBSUB/USER-EVENTS",
    ])
      assert.equal((await post(path, "diagnostic-token")).status, 401, path);
    assert.equal(calls, 0);
    assert.equal(
      (await post("/internal/pubsub/credit-commands/", "push-token")).status,
      204,
    );
    assert.equal(
      (await post("/INTERNAL/PUBSUB/USER-EVENTS", "push-token")).status,
      200,
    );
    assert.equal(calls, 2);
  } finally {
    OAuth2Client.prototype.verifyIdToken = originalVerify;
    Object.assign(config, settings);
    await new Promise((resolve) => server.close(resolve));
  }
});
