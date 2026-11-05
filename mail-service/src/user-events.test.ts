/**
    AI Assistance Disclosure:
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Verification and verified-user event email dispatch tests
    Author review: Pending
**/
import assert from "node:assert/strict";
import test from "node:test";

import {
  InvalidUserEventError,
  parseEmailUpdatedRecipient,
  parseVerificationEmailRecipient,
  parseWelcomeEmailRecipient,
  processUserEvent,
} from "./user-events";

const verifiedEvent = {
  eventId: "event-1",
  version: 1,
  type: "user.verified",
  verificationPurpose: "registration",
  user: {
    id: 42,
    name: "Alex Tan",
    email: "student@u.nus.edu",
    verificationStatus: "verified",
  },
};
const emailUpdatedEvent = {
  ...verifiedEvent,
  verificationPurpose: "email_update",
};

const pendingEvent = {
  eventId: "event-2",
  version: 2,
  type: "user.created",
  user: {
    id: 43,
    name: "Jamie Lee",
    email: "jamie@u.nus.edu",
    verificationStatus: "pending_verification",
    verificationCode: "012345",
  },
};

test("signup verification provides the welcome email recipient", () => {
  assert.deepEqual(parseWelcomeEmailRecipient(verifiedEvent), {
    email: "student@u.nus.edu",
    name: "Alex Tan",
  });
});

test("email-update verification provides the updated-email recipient, not a welcome recipient", () => {
  assert.deepEqual(parseEmailUpdatedRecipient(emailUpdatedEvent), {
    email: "student@u.nus.edu",
    name: "Alex Tan",
  });
  assert.equal(parseWelcomeEmailRecipient(emailUpdatedEvent), undefined);
});

test("email-update verification sends an email-updated email only", async () => {
  const sent: string[] = [];
  await processUserEvent(emailUpdatedEvent, {
    sendWelcomeEmail: async () => { sent.push("welcome"); },
    sendEmailUpdatedEmail: async () => { sent.push("updated"); },
  });
  assert.deepEqual(sent, ["updated"]);
});

test("verified snapshots in created and updated events do not trigger either email", async () => {
  let sent = false;
  for (const type of ["user.created", "user.updated"]) {
    await processUserEvent({ ...verifiedEvent, type }, {
      sendWelcomeEmail: async () => { sent = true; },
      sendVerificationEmail: async () => { sent = true; },
    });
  }
  assert.equal(sent, false);
});

test("pending account events provide a verification email recipient", () => {
  assert.deepEqual(parseVerificationEmailRecipient(pendingEvent), {
    email: "jamie@u.nus.edu",
    name: "Jamie Lee",
    verificationCode: "012345",
  });
  assert.deepEqual(
    parseVerificationEmailRecipient({
      ...pendingEvent,
      type: "user.updated",
      version: 3,
    }),
    {
      email: "jamie@u.nus.edu",
      name: "Jamie Lee",
      verificationCode: "012345",
    },
  );
});

test("pending email updates trigger verification mail", async () => {
  let recipient: { email: string; name: string; verificationCode: string } | undefined;
  await processUserEvent(
    { ...pendingEvent, type: "user.updated", version: 3 },
    {
      sendVerificationEmail: async (value) => {
        recipient = value;
      },
    },
  );
  assert.deepEqual(recipient, {
    email: "jamie@u.nus.edu",
    name: "Jamie Lee",
    verificationCode: "012345",
  });
});

test("verified and unrelated events do not trigger verification email", async () => {
  let sent = false;
  for (const event of [verifiedEvent, { ...pendingEvent, type: "user.deleted" }]) {
    await processUserEvent(event, {
      sendVerificationEmail: async () => { sent = true; },
    });
  }
  assert.equal(sent, false);
});

test("invalid pending verification details are rejected", () => {
  assert.throws(
    () => parseVerificationEmailRecipient({
      ...pendingEvent,
      user: { ...pendingEvent.user, verificationCode: "bad" },
    }),
    InvalidUserEventError,
  );
});

test("invalid user.verified events are rejected", () => {
  assert.throws(
    () => parseWelcomeEmailRecipient({ ...verifiedEvent, user: { name: "Alex" } }),
    InvalidUserEventError,
  );
});

test("delivery failures propagate so Pub/Sub can retry", async () => {
  await assert.rejects(
    processUserEvent(verifiedEvent, {
      sendWelcomeEmail: async () => { throw new Error("SMTP unavailable"); },
    }),
    { message: "SMTP unavailable" },
  );
});

test("email-updated delivery failures propagate so Pub/Sub can retry", async () => {
  await assert.rejects(
    processUserEvent(emailUpdatedEvent, {
      sendEmailUpdatedEmail: async () => { throw new Error("SMTP unavailable"); },
    }),
    { message: "SMTP unavailable" },
  );
});

test("verification email delivery failures propagate for Pub/Sub retry", async () => {
  await assert.rejects(
    processUserEvent(pendingEvent, {
      sendVerificationEmail: async () => { throw new Error("SMTP unavailable"); },
    }),
    { message: "SMTP unavailable" },
  );
});
