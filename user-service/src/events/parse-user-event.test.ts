/**
    AI Assistance Disclosure:
    Tool: Copilot SDK in VS Code, 2026-10-15
    Scope: User Pub/Sub event parsing tests
    Author review: Pending
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Test verification event fields and legacy snapshots
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
  verificationStatus: "pending_verification",
  verificationCode: "012345",
  verificationPurpose: "registration",
};

test("parses full user-created, user-updated, and user-verified snapshots", () => {
  for (const type of ["user.created", "user.updated"] as const) {
    assert.deepEqual(parseUserEvent({ eventId: "event-1", version: 1, type, user }), {
      eventId: "event-1",
      version: 1,
      type,
      user,
    });
  }
  const verifiedUser = {
    ...user,
    verificationStatus: "verified",
    verificationCode: null,
    verificationPurpose: null,
  };
  assert.deepEqual(
    parseUserEvent({
      eventId: "event-2",
      version: 2,
      type: "user.verified",
      user: verifiedUser,
      verificationPurpose: "registration",
    }),
    {
      eventId: "event-2",
      version: 2,
      type: "user.verified",
      user: verifiedUser,
      verificationPurpose: "registration",
    },
  );
});

test("parses user-deleted events", () => {
  assert.deepEqual(
    parseUserEvent({ eventId: "event-2", version: 2, type: "user.deleted", userId: 42 }),
    { eventId: "event-2", version: 2, type: "user.deleted", userId: 42 },
  );
});

test("preserves email-update purpose through verification events", () => {
  const result = parseUserEvent({
    eventId: "event-email-update",
    version: 2,
    type: "user.verified",
    user: {
      ...user,
      verificationStatus: "verified",
      verificationCode: null,
      verificationPurpose: null,
    },
    verificationPurpose: "email_update",
  });
  assert.equal(result.type, "user.verified");
  if (result.type === "user.verified") {
    assert.equal(result.verificationPurpose, "email_update");
  }
});

test("legacy user snapshots default to verified without a stored code", () => {
  const {
    verificationStatus: _status,
    verificationCode: _code,
    verificationPurpose: _purpose,
    ...legacyUser
  } = user;
  assert.deepEqual(
    parseUserEvent({
      eventId: "event-3",
      version: 3,
      type: "user.updated",
      user: legacyUser,
    }),
    {
      eventId: "event-3",
      version: 3,
      type: "user.updated",
      user: {
        ...legacyUser,
        verificationStatus: "verified",
        verificationCode: null,
        verificationPurpose: null,
      },
    },
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
    {
      eventId: "event-8",
      version: 8,
      type: "user.created",
      user: { ...user, verificationStatus: "pending_verification", verificationCode: null },
    },
    {
      eventId: "event-9",
      version: 9,
      type: "user.updated",
      user: { ...user, verificationStatus: "verified", verificationCode: "012345" },
    },
    {
      eventId: "event-10",
      version: 10,
      type: "user.verified",
      user,
    },
  ]) {
    assert.throws(() => parseUserEvent(value));
  }
});
