import assert from "node:assert/strict";
import test from "node:test";
import { ORDER_EVENTS_FILTERS, ORDER_EVENT_TYPES } from "../dist/src/order-event-filters.js";

test("order event subscription filters stay within Pub/Sub's 256-character limit", () => {
  assert.equal(ORDER_EVENTS_FILTERS.length, 2);
  for (const filter of ORDER_EVENTS_FILTERS) {
    assert.ok(filter.length <= 256, `filter is ${filter.length} characters`);
  }
  assert.deepEqual(
    ORDER_EVENTS_FILTERS.flatMap((filter) => [...filter.matchAll(/attributes\.type = "([^"]+)"/g)].map(([, type]) => type)),
    ORDER_EVENT_TYPES,
  );
});
