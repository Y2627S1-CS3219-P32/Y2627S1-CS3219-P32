import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_RETENTION_MS, chatExpiresAt } from "../dist/src/retention.js";

test("chatroom retention expires exactly 30 days after the terminal order event", () => {
  const endedAt = new Date("2026-11-04T06:00:00.000Z");
  assert.equal(CHAT_RETENTION_MS, 30 * 24 * 60 * 60 * 1000);
  assert.equal(chatExpiresAt(endedAt).toISOString(), "2026-12-04T06:00:00.000Z");
});
