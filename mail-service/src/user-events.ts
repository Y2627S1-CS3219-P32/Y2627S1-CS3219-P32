/**
    AI Assistance Disclosure:
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Validating verification and verified-user events and dispatching email
    Author review: Pending
**/
import type {
  VerificationEmailRecipient,
  WelcomeEmailRecipient,
} from "./welcome-email";

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
  if (value.type !== "user.verified") return undefined;
  if (
    typeof value.eventId !== "string" ||
    !value.eventId ||
    typeof value.version !== "number" ||
    !Number.isSafeInteger(value.version) ||
    value.version <= 0
  ) {
    throw new InvalidUserEventError("Verified user event must have a valid ID and version");
  }
  if (!isRecord(value.user)) {
    throw new InvalidUserEventError("Verified user event must include a user");
  }

  const { email, name, verificationStatus } = value.user;
  if (
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof name !== "string" ||
    !name.trim() ||
    verificationStatus !== "verified"
  ) {
    throw new InvalidUserEventError("Verified user event has invalid account details");
  }
  return { email, name: name.trim() };
}

export function parseVerificationEmailRecipient(
  value: unknown,
): VerificationEmailRecipient | undefined {
  if (!isRecord(value)) {
    throw new InvalidUserEventError("User event must be an object");
  }
  if (value.type !== "user.created" && value.type !== "user.updated") return undefined;
  if (
    typeof value.eventId !== "string" ||
    !value.eventId ||
    typeof value.version !== "number" ||
    !Number.isSafeInteger(value.version) ||
    value.version <= 0
  ) {
    throw new InvalidUserEventError("Pending user event must have a valid ID and version");
  }
  if (!isRecord(value.user)) {
    throw new InvalidUserEventError("Pending user event must include a user");
  }
  if (value.user.verificationStatus !== "pending_verification") return undefined;

  const { email, name, verificationCode } = value.user;
  if (
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof name !== "string" ||
    !name.trim() ||
    typeof verificationCode !== "string" ||
    !/^\d{6}$/.test(verificationCode)
  ) {
    throw new InvalidUserEventError("Pending user event has invalid verification details");
  }
  return { email, name: name.trim(), verificationCode };
}

export async function processUserEvent(
  value: unknown,
  senders: {
    sendWelcomeEmail?: (recipient: WelcomeEmailRecipient) => Promise<void>;
    sendVerificationEmail?: (recipient: VerificationEmailRecipient) => Promise<void>;
  },
): Promise<void> {
  const welcomeRecipient = parseWelcomeEmailRecipient(value);
  if (welcomeRecipient) {
    if (!senders.sendWelcomeEmail) {
      console.warn("[mail-service] Mailjet is not configured; welcome email was not sent.");
      return;
    }
    await senders.sendWelcomeEmail(welcomeRecipient);
    return;
  }

  const verificationRecipient = parseVerificationEmailRecipient(value);
  if (!verificationRecipient) return;
  if (!senders.sendVerificationEmail) {
    console.warn("[mail-service] Mailjet is not configured; verification email was not sent.");
    return;
  }
  await senders.sendVerificationEmail(verificationRecipient);
}
