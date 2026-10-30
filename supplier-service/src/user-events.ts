/**AI Assistance Disclosure:
Tool: Claude Code (model: Opus 5.5), date: 2026-10-18
Scope: Parsing user-events and applying them to the local users table (id, display name,
role, soft delete), mirroring order-service.
Author review: Pending. **/

import { sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { users } from "./db/schema.js";

// The message can never be applied, so Pub/Sub should stop redelivering it.
export class InvalidUserEventError extends Error {}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidUserEventError(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidUserEventError(`${what} must be a positive integer`);
  }
  return value;
}

function string(value: unknown, what: string): string {
  if (typeof value !== "string") throw new InvalidUserEventError(`${what} must be a string`);
  return value;
}

// user-events: { type, eventId, version, user: {...} } or { type: "user.deleted", userId }.
// Only id, displayName and role are kept; the password hash is never stored. An event
// older than the stored version (a redelivery, or one overtaken by a deletion) is skipped.
export async function applyUserEvent(message: unknown): Promise<void> {
  const event = record(message, "user event");
  const version = positiveInteger(event.version, "version");

  if (event.type === "user.deleted") {
    const userId = positiveInteger(event.userId, "userId");
    await db.insert(users).values({ id: userId, version, deletedAt: new Date() })
      .onConflictDoUpdate({
        target: users.id,
        set: { version, deletedAt: sql`now()` },
        setWhere: sql`${users.version} < ${version}`,
      });
    return;
  }

  if (event.type !== "user.created" && event.type !== "user.updated") {
    throw new InvalidUserEventError(`Unknown user event type: ${String(event.type)}`);
  }
  const user = record(event.user, "user");
  const values = {
    id: positiveInteger(user.id, "user.id"),
    displayName: string(user.displayName, "user.displayName"),
    role: string(user.role, "user.role"),
    version,
    deletedAt: null,
  };
  await db.insert(users).values(values)
    .onConflictDoUpdate({
      target: users.id,
      set: { displayName: values.displayName, role: values.role, version, deletedAt: null },
      setWhere: sql`${users.version} < ${version}`,
    });
}
