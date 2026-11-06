import assert from "node:assert/strict";
import test from "node:test";

import {
  createPasswordResetToken,
  hashPasswordResetToken,
  PASSWORD_RESET_TTL_MS,
} from "./password-reset";

test("password reset tokens are unique, URL-safe, and stored as hashes", () => {
  const first = createPasswordResetToken();
  const second = createPasswordResetToken();

  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.equal(hashPasswordResetToken(first), hashPasswordResetToken(first));
  assert.notEqual(hashPasswordResetToken(first), first);
  assert.match(hashPasswordResetToken(first), /^[0-9a-f]{64}$/);
  assert.equal(PASSWORD_RESET_TTL_MS, 60 * 60 * 1000);
});
