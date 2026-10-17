/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Tests for ticket issuing and redemption, WebSocket authentication, origin
 * checks, session expiry, and routing order events to the right users' sockets.
 * Author review: Pending.
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { WebSocket } from "ws";

const JWT_SECRET = randomBytes(32).toString("hex");
const ORIGIN = "http://frontend.test";
process.env.JWT_SECRET = JWT_SECRET;
process.env.NOTIFICATION_TICKET_SECRET = randomBytes(32).toString("hex");
process.env.ALLOWED_ORIGINS = ORIGIN;

let server, baseUrl, wsUrl, routeOrderEvent;

// Same format as user-service createAccessToken.
function jwt(userId, { expiresIn = 900, secret = JWT_SECRET } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const content = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: String(userId), iat: now, exp: now + expiresIn })}`;
  return `${content}.${createHmac("sha256", secret).update(content).digest("base64url")}`;
}

async function ticketFor(userId, options) {
  const response = await fetch(`${baseUrl}/tickets`, { method: "POST", headers: { authorization: `Bearer ${jwt(userId, options)}` } });
  assert.equal(response.status, 201);
  return (await response.json()).ticket;
}

// Resolves with the open socket and a queue of its messages, or rejects with the HTTP status.
function connect(ticket, { origin = ORIGIN } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${wsUrl}?ticket=${encodeURIComponent(ticket)}`, { origin });
    const messages = [];
    const waiters = [];
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else messages.push(message);
    });
    const next = () => messages.length > 0
      ? Promise.resolve(messages.shift())
      : new Promise((done) => waiters.push(done));
    socket.on("unexpected-response", (_request, response) => reject(new Error(String(response.statusCode))));
    socket.on("error", reject);
    socket.on("open", async () => {
      assert.deepEqual(await next(), { type: "ready" });
      resolve({ socket, next, pending: () => messages.length });
    });
  });
}

before(async () => {
  const { createNotificationServer } = await import("../dist/server.js");
  ({ routeOrderEvent } = await import("../dist/order-events.js"));
  ({ server } = createNotificationServer());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  wsUrl = `ws://127.0.0.1:${server.address().port}/ws`;
});

after(() => {
  server.closeAllConnections?.();
  server.close();
});

test("POST /tickets needs a valid user JWT", async () => {
  const noToken = await fetch(`${baseUrl}/tickets`, { method: "POST" });
  assert.equal(noToken.status, 401);
  for (const token of [jwt(1, { secret: "x".repeat(40) }), jwt(1, { expiresIn: -1 }), "not-a-jwt"]) {
    const response = await fetch(`${baseUrl}/tickets`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 401);
  }
  const ok = await fetch(`${baseUrl}/tickets`, { method: "POST", headers: { authorization: `Bearer ${jwt(1)}` } });
  assert.equal(ok.status, 201);
  const body = await ok.json();
  assert.equal(typeof body.ticket, "string");
  assert.equal(body.expiresIn, 30);
});

test("a WebSocket needs a valid, unused ticket and an allowed origin", async () => {
  await assert.rejects(connect(""), /401/);
  await assert.rejects(connect("garbage.ticket"), /401/);

  const ticket = await ticketFor(1);
  const [payload, signature] = ticket.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url")), u: 2 })).toString("base64url");
  await assert.rejects(connect(`${forged}.${signature}`), /401/);

  await assert.rejects(connect(ticket, { origin: "http://evil.test" }), /403/);

  const { socket } = await connect(ticket);
  socket.close();
  await assert.rejects(connect(ticket), /401/); // single use

  const wrongPath = new WebSocket(wsUrl.replace("/ws", "/other"), { origin: ORIGIN });
  const [, response] = await once(wrongPath, "unexpected-response");
  assert.equal(response.statusCode, 404);
});

test("order events reach the requester's and courier's sockets only", async () => {
  const requesterTab1 = await connect(await ticketFor(10));
  const requesterTab2 = await connect(await ticketFor(10));
  const courier = await connect(await ticketFor(20));
  const bystander = await connect(await ticketFor(30));

  const event = {
    eventId: "e1",
    type: "order.accepted",
    orderId: "o1",
    sequence: 3,
    state: "ACCEPTED",
    order: { id: "o1", requesterId: 10, courierId: 20, title: "Coffee" },
  };
  assert.deepEqual(routeOrderEvent(event).sort(), [10, 20]);
  for (const client of [requesterTab1, requesterTab2, courier]) {
    assert.deepEqual(await client.next(), { type: "order.event", event });
  }
  assert.equal(bystander.pending(), 0);

  // Before acceptance there is no courier; offline users are skipped.
  assert.deepEqual(routeOrderEvent({ ...event, order: { ...event.order, courierId: null } }), [10]);
  assert.deepEqual(routeOrderEvent({ ...event, order: { requesterId: 99, courierId: null } }), []);
  assert.deepEqual(routeOrderEvent({ nonsense: true }), []);

  requesterTab2.socket.close();
  await once(requesterTab2.socket, "close");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(routeOrderEvent(event).sort(), [10, 20]);
  await requesterTab1.next();
  await courier.next();

  for (const client of [requesterTab1, courier, bystander]) client.socket.close();
});

test("the socket closes when the user's session expires", async () => {
  const { socket } = await connect(await ticketFor(40, { expiresIn: 2 }));
  const [code, reason] = await once(socket, "close");
  assert.equal(code, 4001);
  assert.equal(reason.toString(), "Session expired");
});
