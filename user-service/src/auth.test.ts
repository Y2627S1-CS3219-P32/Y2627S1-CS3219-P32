/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Password-hash, JWT, and registration validation tests
    Author review: Done
**/
import assert from "node:assert/strict";
import test from "node:test";

import { assertAdministratorCanBeDemoted } from "./administrator-constraints";
import { createAccessToken, hashPassword, verifyAccessToken, verifyPassword } from "./auth";
import {
  validateDisplayName,
  validateRegistrationPassword,
  validateUniversityEmail,
} from "./registration-validation";

const secret = "a-test-secret-that-is-at-least-32-bytes-long";

test("administrator role changes reject self-demotion and demoting the last admin", async () => {
  await assert.rejects(
    assertAdministratorCanBeDemoted(7, 7, async () => 2),
    { statusCode: 409, message: "You cannot demote your own administrator account" },
  );
  await assert.rejects(
    assertAdministratorCanBeDemoted(8, 7, async () => 1),
    { statusCode: 409, message: "The last administrator cannot be demoted" },
  );
  await assert.doesNotReject(assertAdministratorCanBeDemoted(8, 7, async () => 2));
});

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

test("display names require 2 to 50 ASCII letters and internal hyphens", () => {
  assert.equal(validateDisplayName("Alex-Smith"), "Alex-Smith");
  assert.equal(validateDisplayName("Jo"), "Jo");
  for (const displayName of ["A", "Alex Smith", "-Alex", "Alex-", "Alex2", "_Alex", "Élodie"]) {
    assert.throws(() => validateDisplayName(displayName), { statusCode: 400 });
  }
  assert.throws(() => validateDisplayName("A".repeat(51)), { statusCode: 400 });
});

test("registration emails are limited to the allowed domains", () => {
  assert.equal(validateUniversityEmail("Student@U.NUS.EDU"), "student@u.nus.edu");
  assert.equal(validateUniversityEmail("student@nus.edu.sg"), "student@nus.edu.sg");
  assert.equal(validateUniversityEmail("student@foc.com"), "student@foc.com");
  for (const email of ["not-an-email", "student@example.com", "student@sub.foc.com"]) {
    assert.throws(() => validateUniversityEmail(email), { statusCode: 400 });
  }
});

test("registration passwords require length, uppercase, lowercase, and a number", () => {
  assert.equal(validateRegistrationPassword("Password123"), "Password123");
  for (const password of ["short1A", "A😀bc1", "lowercase1", "UPPERCASE1", "PasswordOnly"]) {
    assert.throws(() => validateRegistrationPassword(password), { statusCode: 400 });
  }
});
