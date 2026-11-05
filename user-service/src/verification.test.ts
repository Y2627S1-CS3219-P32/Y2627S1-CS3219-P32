/**
    AI Assistance Disclosure:
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Account verification code tests
    Author review: Pending
**/
import assert from "node:assert/strict";
import test from "node:test";

import { createVerificationCode, verificationCodeMatches } from "./verification";

test("verification codes are six-digit decimal strings, including leading zeroes", () => {
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.match(createVerificationCode(), /^\d{6}$/);
  }
});

test("verification code comparison only accepts the exact code", () => {
  assert.equal(verificationCodeMatches("001234", "001234"), true);
  assert.equal(verificationCodeMatches("001234", "1234"), false);
  assert.equal(verificationCodeMatches("001234", "001235"), false);
});
