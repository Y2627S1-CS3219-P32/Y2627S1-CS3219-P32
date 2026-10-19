/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: Redaction invariants for the event bus tap: secrets, password hashes and
 * tokens never survive, e-mail addresses are masked, identifiers stay readable.
 * Author review: Pending.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { describeError, maskEmail, redactValue, scrubString, REDACTED } from "../dist/redact.js";

const HASH = "scrypt$0123456789abcdef0123456789abcdef$" + "ab".repeat(64);
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI3In0.c2lnbmF0dXJlLXNpZ25hdHVyZQ";

// The real user-events payload shape from user-service/src/events/user-events.ts.
const userCreated = {
  type: "user.created",
  user: { id: 7, name: "Ada Tan", displayName: "ada", email: "ada.tan@u.nus.edu", role: "student", passwordHash: HASH },
  eventId: "6f1c0000-0000-4000-8000-000000000001",
  version: 42,
};

test("password hashes and e-mail addresses in user events never survive", () => {
  const out = JSON.stringify(redactValue(userCreated));
  assert.ok(!out.includes(HASH));
  assert.ok(!out.includes("scrypt$"));
  assert.ok(!out.includes("ada.tan"));
  assert.ok(out.includes("@u.nus.edu"), "the e-mail domain stays visible");
  const user = redactValue(userCreated).user;
  assert.equal(user.passwordHash, REDACTED);
  assert.equal(user.email, maskEmail("ada.tan@u.nus.edu"));
  assert.equal(user.displayName, "ada");
  assert.equal(user.id, 7);
});

test("identifiers used to follow a flow are kept", () => {
  const command = { type: "credit.reserve", requestId: "r-1", correlationId: "c-1", orderId: "o-1", requesterId: 7, amount: 12 };
  assert.deepEqual(redactValue(command), command);
  const event = { eventId: "e-1", commandId: "k-1", sequence: 3, version: 9, transactionIds: ["t-1"], deltas: { requesterReserved: 12 } };
  assert.deepEqual(redactValue(event), event);
});

test("sensitive keys are redacted whatever their value or nesting", () => {
  const input = {
    password: "hunter2", newPassword: "x", token: "abc", access_token: "abc", apiKey: "k", "api-key": "k",
    secret: "s", internalSharedSecret: "s", authorization: "Basic Zm9v", Cookie: "sid=1", credentials: { user: "u" },
    privateKey: "p", salt: "00", ticket: "t", nested: [{ refreshToken: "r" }],
  };
  const out = redactValue(input);
  for (const [key, value] of Object.entries(out)) {
    if (key === "nested") continue;
    assert.equal(value, REDACTED, key);
  }
  assert.equal(out.nested[0].refreshToken, REDACTED);
  assert.ok(!JSON.stringify(out).includes("hunter2"));
});

test("secret-looking values are scrubbed even under harmless keys", () => {
  const out = redactValue({
    note: `hash ${HASH} here`,
    header: `Bearer ${JWT}`,
    jwt: JWT,
    endpoint: "http://order-service:3000/internal/pubsub/order-events?token=local-only-order-internal-secret-0000&x=1",
    pem: "-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----",
    text: "contact bob.lee@example.com please",
  });
  const json = JSON.stringify(out);
  for (const leaked of ["scrypt$", JWT, "local-only-order-internal-secret-0000", "MIIEvQ", "bob.lee"]) {
    assert.ok(!json.includes(leaked), leaked);
  }
  assert.ok(out.endpoint.includes("x=1"));
  assert.ok(out.text.includes("@example.com"));
});

test("e-mail masking keeps one character and the domain only", () => {
  assert.equal(maskEmail("ada.tan@u.nus.edu"), "a***@u.nus.edu");
  assert.equal(maskEmail("x@y.io"), "x***@y.io");
  assert.equal(maskEmail("not an email"), REDACTED);
  assert.equal(scrubString("mail ada@u.nus.edu now"), "mail a***@u.nus.edu now");
});

test("keys that look like e-mail addresses are masked too", () => {
  const out = redactValue({ "ada@u.nus.edu": 1 });
  assert.deepEqual(Object.keys(out), ["a***@u.nus.edu"]);
});

test("__proto__ keys stay plain data and do not pollute prototypes", () => {
  const input = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}');
  const out = redactValue(input);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.ok(Object.hasOwn(out, "__proto__"));
});

test("depth, string, array and key counts are bounded", () => {
  let deep = { leaf: true };
  for (let i = 0; i < 100; i++) deep = { child: deep };
  assert.ok(JSON.stringify(redactValue(deep)).includes("[truncated: too deep]"));
  const long = redactValue("a".repeat(10_000));
  assert.ok(long.length < 2_100 && long.endsWith("[truncated]"));
  const array = redactValue(Array.from({ length: 1000 }, (_, i) => i));
  assert.equal(array.length, 201);
  assert.match(array[200], /800 more items/);
  const wide = redactValue(Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`k${i}`, i])));
  assert.equal(Object.keys(wide).length, 201);
});

test("primitives pass through", () => {
  assert.equal(redactValue(5), 5);
  assert.equal(redactValue(null), null);
  assert.equal(redactValue(true), true);
  assert.equal(redactValue("order.created"), "order.created");
});

// Repair T3 (self-tested): patterns run before the 2000-character cut.
test("a secret straddling the truncation boundary is redacted before the cut", () => {
  // The reviewer's exact probe: 1990 characters, then the address with no separator.
  assert.ok(!redactValue({ note: "x".repeat(1990) + "ada.tan@u.nus.edu" }).note.includes("ada.tan"));
  for (const pad of [1985, 1990, 1995, 1999]) {
    const email = redactValue({ note: `${"x".repeat(pad)} ada.tan@u.nus.edu and more` }).note;
    assert.ok(!email.includes("ada.tan") && !email.includes("da.ta"), `e-mail at ${pad}`);
    assert.ok(email.endsWith("…[truncated]") && email.length === 2000 + "…[truncated]".length);
    if (pad <= 1990) assert.ok(email.includes(" a***@"), `masked e-mail shown at ${pad}`);
    const jwt = redactValue({ note: "x".repeat(pad) + JWT }).note;
    assert.ok(!jwt.includes("eyJ") && !jwt.includes(JWT.slice(0, 8)), `JWT at ${pad}`);
  }
  assert.ok(!describeError(new Error(`${"x".repeat(495)} ${JWT}`)).includes("eyJ"), "error text is scrubbed before its 500-char cut");
});

test("scrubbing a long string stays fast and bounded", () => {
  const started = performance.now();
  for (const long of ["a".repeat(65536), "a.".repeat(32768), "a@".repeat(32768), `ada.tan@u.nus.edu ${"b".repeat(65536)}`]) {
    const out = scrubString(long);
    assert.ok(out.length <= 2000 + "…[truncated]".length && out.endsWith("…[truncated]"));
    assert.ok(!out.includes("ada.tan"));
  }
  assert.ok(performance.now() - started < 1000, "64 KiB strings are scrubbed in well under a second");
});
