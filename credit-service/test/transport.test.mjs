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
test("HTTP rejects unauthenticated mutations and forged event delivery", async () => {
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
      "/internal/v1/credit-reservations",
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
