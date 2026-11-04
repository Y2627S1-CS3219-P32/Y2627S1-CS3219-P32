/**
    AI Assistance Disclosure:
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Validating user-created events and dispatching welcome emails
    Author review: Pending
**/
import type { WelcomeEmailRecipient } from "./welcome-email";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class InvalidUserEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUserEventError";
  }
}

export function parseWelcomeEmailRecipient(value: unknown): WelcomeEmailRecipient | undefined {
  if (!isRecord(value)) {
    throw new InvalidUserEventError("User event must be an object");
  }
  if (value.type !== "user.created") return undefined;
  if (
    typeof value.eventId !== "string" ||
    !value.eventId ||
    typeof value.version !== "number" ||
    !Number.isSafeInteger(value.version) ||
    value.version <= 0
  ) {
    throw new InvalidUserEventError("Created user event must have a valid ID and version");
  }
  if (!isRecord(value.user)) {
    throw new InvalidUserEventError("Created user event must include a user");
  }

  const { email, name } = value.user;
  if (
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof name !== "string" ||
    !name.trim()
  ) {
    throw new InvalidUserEventError("Created user event has invalid email or name");
  }
  return { email, name: name.trim() };
}

export async function processUserEvent(
  value: unknown,
  sendWelcomeEmail: ((recipient: WelcomeEmailRecipient) => Promise<void>) | undefined,
): Promise<void> {
  const recipient = parseWelcomeEmailRecipient(value);
  if (!recipient) return;
  if (!sendWelcomeEmail) {
    console.warn("[mail-service] Mailjet is not configured; welcome email was not sent.");
    return;
  }
  await sendWelcomeEmail(recipient);
}
