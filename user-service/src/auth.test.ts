/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Password-hash and JWT helper tests
    Author review: Pending
**/
import assert from "node:assert/strict";
import test from "node:test";

import { createAccessToken, hashPassword, verifyAccessToken, verifyPassword } from "./auth";

const secret = "a-test-secret-that-is-at-least-32-bytes-long";

test("password hashes verify the correct password only", () => {
  const hash = hashPassword("Password123!");
  assert.notEqual(hash, "Password123!");
  assert.match(hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(verifyPassword("Password123!", hash), true);
  assert.equal(verifyPassword("not-the-password", hash), false);
});

test("access tokens verify, reject tampering, and expire", () => {
  const token = createAccessToken(42, secret, 60, 1_000);
  assert.deepEqual(verifyAccessToken(token, secret, 1_059), { userId: 42 });
  assert.equal(verifyAccessToken(token, secret, 1_060), undefined);

  const [header, payload, signature] = token.split(".");
  const tamperedPayload = Buffer.from(
    JSON.stringify({ sub: "43", iat: 1_000, exp: 1_060 }),
  ).toString("base64url");
  assert.equal(verifyAccessToken(`${header}.${tamperedPayload}.${signature}`, secret, 1_001), undefined);
  assert.equal(verifyAccessToken(token, "a-different-secret-that-is-also-long-enough"), undefined);
});
