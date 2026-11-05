/**
    AI Assistance Disclosure:
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Pub/Sub verification and welcome email route tests
    Author review: Pending
**/
import assert from "node:assert/strict";
import test from "node:test";

import type { AddressInfo } from "node:net";

import { createApp } from "./app";

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
const emailUpdatedEvent = { ...verifiedEvent, verificationPurpose: "email_update" };

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

async function postEvent(
  event: unknown,
  senders: {
    sendWelcomeEmail?: (recipient: { name: string; email: string }) => Promise<void>;
    sendEmailUpdatedEmail?: (recipient: { name: string; email: string }) => Promise<void>;
    sendPasswordResetEmail?: (
      recipient: { name: string; email: string; resetToken: string }
    ) => Promise<void>;
    sendVerificationEmail?: (
      recipient: { name: string; email: string; verificationCode: string }
    ) => Promise<void>;
  },
  path = "/pubsub/user-events",
): Promise<Response> {
  const app = createApp(senders);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: { data: Buffer.from(JSON.stringify(event)).toString("base64") },
      }),
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("user.verified push sends welcome email and acknowledges the event", async () => {
  let recipient: { name: string; email: string } | undefined;
  const response = await postEvent(verifiedEvent, {
    sendWelcomeEmail: async (value) => {
      recipient = value;
    },
  });

  test("email-update verification push sends email-updated mail instead of welcome mail", async () => {
    const sent: string[] = [];
    const response = await postEvent(emailUpdatedEvent, {
      sendWelcomeEmail: async () => { sent.push("welcome"); },
      sendEmailUpdatedEmail: async () => { sent.push("updated"); },
    });

    assert.equal(response.status, 204);
    assert.deepEqual(sent, ["updated"]);
  });

  assert.equal(response.status, 204);
  assert.deepEqual(recipient, { name: "Alex Tan", email: "student@u.nus.edu" });
});

test("user.created and other user events are acknowledged without sending email", async () => {
  let sent = false;
  for (const type of ["user.created", "user.updated"]) {
    const response = await postEvent({ ...verifiedEvent, type }, {
      sendWelcomeEmail: async () => { sent = true; },
      sendVerificationEmail: async () => { sent = true; },
    });
    assert.equal(response.status, 204);
  }
  assert.equal(sent, false);
});

test("pending account push sends verification email and acknowledges the event", async () => {
  let recipient:
    | { name: string; email: string; verificationCode: string }
    | undefined;
  const response = await postEvent(pendingEvent, {
    sendVerificationEmail: async (value) => {
      recipient = value;
    },
  });

  assert.equal(response.status, 204);
  assert.deepEqual(recipient, {
    name: "Jamie Lee",
    email: "jamie@u.nus.edu",
    verificationCode: "012345",
  });
});

test("delivery failures return 500 so Pub/Sub can retry", async () => {
  const response = await postEvent(verifiedEvent, {
    sendWelcomeEmail: async () => {
      throw new Error("SMTP unavailable");
    },
  });

  test("email-updated delivery failures return 500 so Pub/Sub can retry", async () => {
    const response = await postEvent(emailUpdatedEvent, {
      sendEmailUpdatedEmail: async () => {
        throw new Error("SMTP unavailable");
      },
    });

    assert.equal(response.status, 500);
  });

  assert.equal(response.status, 500);
});

test("invalid user events are acknowledged to avoid poison-message retries", async () => {
  const response = await postEvent(
    { ...verifiedEvent, user: { email: "not-an-email", name: "" } },
    {},
  );

  assert.equal(response.status, 204);
});

test("password reset push sends the reset email and acknowledges the event", async () => {
  let recipient: { email: string; name: string; resetToken: string } | undefined;
  const resetToken = "a".repeat(43);
  const response = await postEvent({
    type: "password_reset.requested",
    eventId: "reset-event",
    userId: 42,
    email: "student@u.nus.edu",
    name: "Alex Tan",
    resetToken,
  }, {
    sendPasswordResetEmail: async (value) => {
      recipient = value;
    },
  }, "/pubsub/password-reset");

  assert.equal(response.status, 204);
  assert.deepEqual(recipient, {
    email: "student@u.nus.edu",
    name: "Alex Tan",
    resetToken,
  });
});
