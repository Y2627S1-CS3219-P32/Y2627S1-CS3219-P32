/**
    AI Assistance Disclosure:
    Tool: Copilot SDK in VS Code, 2026-10-15
    Scope: Runtime validation for user Pub/Sub events
    Author review: Pending
**/
import type { UserEvent, UserSnapshot } from "./user-events";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseUserSnapshot(value: unknown): UserSnapshot {
  if (
    !isRecord(value) ||
    !isPositiveSafeInteger(value.id) ||
    typeof value.name !== "string" ||
    typeof value.displayName !== "string" ||
    typeof value.email !== "string" ||
    (value.role !== "student" && value.role !== "admin") ||
    typeof value.passwordHash !== "string"
  ) {
    throw new Error("Invalid user snapshot in Pub/Sub event");
  }

  return {
    id: value.id,
    name: value.name,
    displayName: value.displayName,
    email: value.email,
    role: value.role,
    passwordHash: value.passwordHash,
  };
}

export function parseUserEvent(value: unknown): UserEvent {
  if (
    !isRecord(value) ||
    typeof value.eventId !== "string" ||
    !value.eventId ||
    !isPositiveSafeInteger(value.version)
  ) {
    throw new Error("Invalid Pub/Sub user event envelope");
  }

  if (value.type === "user.created" || value.type === "user.updated") {
    return {
      eventId: value.eventId,
      version: value.version,
      type: value.type,
      user: parseUserSnapshot(value.user),
    };
  }

  if (
    value.type === "user.deleted" &&
    isPositiveSafeInteger(value.userId)
  ) {
    return {
      eventId: value.eventId,
      version: value.version,
      type: value.type,
      userId: value.userId,
    };
  }

  throw new Error("Unsupported Pub/Sub user event");
}
