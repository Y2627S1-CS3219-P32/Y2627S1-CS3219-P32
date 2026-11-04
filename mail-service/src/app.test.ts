/**
    AI Assistance Disclosure:
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Pub/Sub push route tests for mail-service
    Author review: Pending
**/
import assert from "node:assert/strict";
import test from "node:test";

import type { AddressInfo } from "node:net";

import { createApp } from "./app";

const createdEvent = {
  eventId: "event-1",
  version: 1,
  type: "user.created",
  user: { id: 42, name: "Alex Tan", email: "student@u.nus.edu" },
};

async function postEvent(
  event: unknown,
  sendWelcomeEmail: (recipient: { name: string; email: string }) => Promise<void>,
): Promise<Response> {
  const app = createApp(sendWelcomeEmail);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  try {
    return await fetch(`http://127.0.0.1:${address.port}/pubsub/user-events`, {
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

test("user.created push sends welcome email and acknowledges the event", async () => {
  let recipient: { name: string; email: string } | undefined;
  const response = await postEvent(createdEvent, async (value) => {
    recipient = value;
  });

  assert.equal(response.status, 204);
  assert.deepEqual(recipient, { name: "Alex Tan", email: "student@u.nus.edu" });
});

test("other user events are acknowledged without sending email", async () => {
  let sent = false;
  const response = await postEvent(
    { ...createdEvent, type: "user.updated" },
    async () => { sent = true; },
  );

  assert.equal(response.status, 204);
  assert.equal(sent, false);
});

test("delivery failures return 500 so Pub/Sub can retry", async () => {
  const response = await postEvent(createdEvent, async () => {
    throw new Error("SMTP unavailable");
  });

  assert.equal(response.status, 500);
});

test("invalid user events are acknowledged to avoid poison-message retries", async () => {
  const response = await postEvent(
    { ...createdEvent, user: { email: "not-an-email", name: "" } },
    async () => {},
  );

  assert.equal(response.status, 204);
});
