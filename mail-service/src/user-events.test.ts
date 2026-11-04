/**
    AI Assistance Disclosure:
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: User-created event email dispatch tests
    Author review: Pending
**/
import assert from "node:assert/strict";
import test from "node:test";

import { InvalidUserEventError, parseWelcomeEmailRecipient, processUserEvent } from "./user-events";

const createdEvent = {
  eventId: "event-1",
  version: 1,
  type: "user.created",
  user: {
    id: 42,
    name: "Alex Tan",
    email: "student@u.nus.edu",
  },
};

test("user.created event provides the welcome email recipient", () => {
  assert.deepEqual(parseWelcomeEmailRecipient(createdEvent), {
    email: "student@u.nus.edu",
    name: "Alex Tan",
  });
});

test("other user events do not trigger welcome email", async () => {
  let sent = false;
  await processUserEvent(
    { ...createdEvent, type: "user.updated" },
    async () => { sent = true; },
  );
  assert.equal(sent, false);
});

test("invalid user.created events are rejected", () => {
  assert.throws(
    () => parseWelcomeEmailRecipient({ ...createdEvent, user: { name: "Alex" } }),
    InvalidUserEventError,
  );
});

test("delivery failures propagate so Pub/Sub can retry", async () => {
  await assert.rejects(
    processUserEvent(createdEvent, async () => { throw new Error("SMTP unavailable"); }),
    { message: "SMTP unavailable" },
  );
});
