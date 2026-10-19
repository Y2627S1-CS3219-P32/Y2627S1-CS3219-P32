import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { notificationsForCreditEvent, notificationsForOrderEvent } from "../dist/rules.js";

function creditEvent(type = "credit.reserved", overrides = {}) {
  return {
    eventId: randomUUID(), type, occurredAt: "2026-10-19T00:00:00Z",
    requestId: randomUUID(), correlationId: randomUUID(),
    ...(type === "credit.account_allocated" ? {} : { orderId: "6f1c2e0a-8a43-4c1e-9d6f-2b7f9e1a4c55" }),
    data: {
      status: "SUCCEEDED", applied: true, requesterId: 10, courierId: 20, amount: 5,
      deltas: { requesterTotal: 0, requesterReserved: 5, courierTotal: 0 },
      ...overrides,
    },
  };
}

test("credit movements notify the requester and transfer also notifies the courier", () => {
  for (const type of ["credit.account_allocated", "credit.reserved", "credit.released", "credit.transferred"]) {
    const event = creditEvent(type);
    const notifications = notificationsForCreditEvent(event);
    assert.deepEqual(notifications.map((n) => n.userId), type === "credit.transferred" ? [10, 20] : [10]);
    for (const notification of notifications) {
      assert.equal(notification.source, "credit");
      assert.deepEqual(notification.payload, { amount: 5 });
      assert.equal(notification.orderId, event.orderId ?? null);
      assert.equal(notification.createdAt, "2026-10-19T00:00:00.000Z");
    }
    assert.deepEqual(notificationsForCreditEvent(event), notifications);
    assert.equal(new Set(notifications.map((n) => n.id)).size, notifications.length);
  }
});

test("credit rules ignore no-ops, rejections, unknown events and malformed input", () => {
  const event = creditEvent();
  const invalid = [
    null, {}, { ...event, eventId: "bad" }, { ...event, orderId: "bad" },
    { ...event, orderId: undefined }, { ...event, occurredAt: "bad" },
    { ...event, data: null }, { ...event, type: "credit.future" },
    creditEvent("credit.order_succeeded"), creditEvent("credit.reservation_rejected"),
    creditEvent("credit.order_rejected"), creditEvent("credit.reserved", { applied: false }),
    creditEvent("credit.reserved", { status: "REJECTED" }),
    ...[0, -1, 1.5, "5", Number.MAX_SAFE_INTEGER + 1].map((amount) => creditEvent("credit.reserved", { amount })),
    ...[0, -1, "10", 1.5].map((requesterId) => creditEvent("credit.reserved", { requesterId })),
    creditEvent("credit.transferred", { courierId: undefined }),
  ];
  for (const input of invalid) assert.deepEqual(notificationsForCreditEvent(input), []);
});

test("credit ids ignore UUID case and distinguish recipients and event sources", () => {
  const event = creditEvent("credit.transferred");
  const notifications = notificationsForCreditEvent(event);
  const uppercase = notificationsForCreditEvent({ ...event, eventId: event.eventId.toUpperCase() });
  assert.deepEqual(uppercase, notifications);
  const [order] = notificationsForOrderEvent({
    ...event, type: "order.opened", order: { requesterId: 10, title: "Coffee", creditReward: 5 },
  });
  assert.notEqual(order.id, notifications[0].id);
});

test("order settlement has no duplicate payment notification", () => {
  const event = creditEvent();
  assert.deepEqual(notificationsForOrderEvent({
    ...event, type: "order.settled", order: { requesterId: 10, courierId: 20, title: "Coffee", creditReward: 5 },
  }), []);
});
