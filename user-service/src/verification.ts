/**
    AI Assistance Disclosure:
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Account verification code generation and comparison
    Author review: Pending
**/
import { createHash, randomInt, timingSafeEqual } from "node:crypto";

export function createVerificationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function verificationCodeMatches(expected: string, supplied: string): boolean {
  const expectedDigest = createHash("sha256").update(expected).digest();
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}
