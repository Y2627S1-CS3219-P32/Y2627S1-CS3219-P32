/**
    AI Assistance Disclosure:
    Tool: Copilot SDK in VS Code, 2026-10-15
    Scope: User Pub/Sub event parsing tests
    Author review: Pending
**/
import assert from "node:assert/strict";
import test from "node:test";

import { parseUserEvent } from "./parse-user-event";

const user = {
  id: 42,
  name: "Alex Smith",
  displayName: "Alex-Smith",
  email: "alex@u.nus.edu",
  role: "student",
  passwordHash: "scrypt$not-a-plaintext-password",
};

test("parses full user-created and user-updated snapshots", () => {
  for (const type of ["user.created", "user.updated"] as const) {
    assert.deepEqual(parseUserEvent({ eventId: "event-1", version: 1, type, user }), {
      eventId: "event-1",
      version: 1,
      type,
      user,
    });
  }
});

test("parses user-deleted events", () => {
  assert.deepEqual(
    parseUserEvent({ eventId: "event-2", version: 2, type: "user.deleted", userId: 42 }),
    { eventId: "event-2", version: 2, type: "user.deleted", userId: 42 },
  );
});

test("rejects malformed user event envelopes and snapshots", () => {
  for (const value of [
    null,
    { type: "user.deleted", userId: 42 },
    { eventId: "event-3", version: 3, type: "user.deleted", userId: 0 },
    { eventId: "event-4", version: 4, type: "user.created", user: { ...user, role: "owner" } },
    {
      eventId: "event-5",
      version: 5,
      type: "user.updated",
      user: { ...user, id: Number.MAX_SAFE_INTEGER + 1 },
    },
    { eventId: "event-6", version: 6, type: "unknown", userId: 42 },
    { eventId: "event-7", version: 0, type: "user.deleted", userId: 42 },
  ]) {
    assert.throws(() => parseUserEvent(value));
  }
});
