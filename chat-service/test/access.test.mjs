import assert from "node:assert/strict";
import test from "node:test";
import { canAccessChat } from "../dist/src/access.js";

test("only the requester and assigned courier can access a chatroom", () => {
  const room = { requesterId: 7, courierId: 12 };
  assert.equal(canAccessChat(room, 7), true);
  assert.equal(canAccessChat(room, 12), true);
  assert.equal(canAccessChat(room, 99), false);
});

test("an unassigned chatroom is accessible only to its requester", () => {
  const room = { requesterId: 7, courierId: null };
  assert.equal(canAccessChat(room, 7), true);
  assert.equal(canAccessChat(room, 12), false);
});
