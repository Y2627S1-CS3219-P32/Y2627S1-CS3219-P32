/**
    AI Assistance Disclosure:
    Tool: Copilot SDK in VS Code, 2026-10-15
    Scope: Runtime validation for user Pub/Sub events
    Author review: Pending
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Validate verification fields in event snapshots
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
    typeof value.passwordHash !== "string" ||
    (value.verificationStatus !== undefined &&
      value.verificationStatus !== "pending_verification" &&
      value.verificationStatus !== "verified") ||
    (value.verificationCode !== undefined &&
      value.verificationCode !== null &&
      typeof value.verificationCode !== "string") ||
    (value.verificationPurpose !== undefined &&
      value.verificationPurpose !== null &&
      value.verificationPurpose !== "registration" &&
      value.verificationPurpose !== "email_update")
  ) {
    throw new Error("Invalid user snapshot in Pub/Sub event");
  }
  const verificationStatus = value.verificationStatus ?? "verified";
  const verificationCode = value.verificationCode ?? null;
  const verificationPurpose = value.verificationPurpose ?? null;
  if (
    (verificationStatus === "pending_verification" && typeof verificationCode !== "string") ||
    (verificationStatus === "verified" && verificationCode !== null)
  ) {
    throw new Error("Invalid account verification fields in Pub/Sub event");
  }

  return {
    id: value.id,
    name: value.name,
    displayName: value.displayName,
    email: value.email,
    role: value.role,
    passwordHash: value.passwordHash,
    verificationStatus,
    verificationCode,
    verificationPurpose,
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

  if (
    value.type === "user.created" ||
    value.type === "user.updated" ||
    value.type === "user.verified"
  ) {
    const user = parseUserSnapshot(value.user);
    if (value.type === "user.verified" && user.verificationStatus !== "verified") {
      throw new Error("Verified user event must contain a verified account");
    }
    if (value.type === "user.verified") {
      if (
        value.verificationPurpose !== undefined &&
        value.verificationPurpose !== "registration" &&
        value.verificationPurpose !== "email_update"
      ) {
        throw new Error("Verified user event must contain a valid verification purpose");
      }
      return {
        eventId: value.eventId,
        version: value.version,
        type: value.type,
        user,
        verificationPurpose: value.verificationPurpose ?? "registration",
      };
    }
    return {
      eventId: value.eventId,
      version: value.version,
      type: value.type,
      user,
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
