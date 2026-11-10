/**
    AI Assistance Disclosure:
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Validating verification and verified-user events and dispatching email
    Author review: Pending
    Tool: Claude Code (Opus 5.5), date: 2026-11-10
    Scope: logging through the shared pino logger
    Author review: Pending
**/
import { logger } from "./shared/logger";
import type {
  EmailUpdatedRecipient,
  PasswordResetEmailRecipient,
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
  const verificationPurpose = value.verificationPurpose ?? "registration";
  if (verificationPurpose === "email_update") return undefined;
  if (verificationPurpose !== "registration") {
    throw new InvalidUserEventError("Verified user event has an invalid verification purpose");
  }
  return parseVerifiedEmailRecipient(value);
}

export function parseEmailUpdatedRecipient(value: unknown): EmailUpdatedRecipient | undefined {
  if (!isRecord(value)) {
    throw new InvalidUserEventError("User event must be an object");
  }
  if (value.type !== "user.verified" || value.verificationPurpose !== "email_update") {
    return undefined;
  }
  return parseVerifiedEmailRecipient(value);
}

export function parsePasswordResetEmailRecipient(
  value: unknown,
): PasswordResetEmailRecipient | undefined {
  if (!isRecord(value)) {
    throw new InvalidUserEventError("User event must be an object");
  }
  if (value.type !== "password_reset.requested") return undefined;
  if (
    typeof value.eventId !== "string" ||
    !value.eventId ||
    typeof value.userId !== "number" ||
    !Number.isSafeInteger(value.userId) ||
    value.userId <= 0
  ) {
    throw new InvalidUserEventError("Password reset event must have a valid ID and version");
  }
  const { email, name, resetToken } = value;
  if (
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof name !== "string" ||
    !name.trim() ||
    typeof resetToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(resetToken)
  ) {
    throw new InvalidUserEventError("Password reset event has invalid recipient details");
  }
  return { email, name: name.trim(), resetToken };
}

function parseVerifiedEmailRecipient(value: Record<string, unknown>): WelcomeEmailRecipient {
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
    sendEmailUpdatedEmail?: (recipient: EmailUpdatedRecipient) => Promise<void>;
    sendPasswordResetEmail?: (recipient: PasswordResetEmailRecipient) => Promise<void>;
    sendVerificationEmail?: (recipient: VerificationEmailRecipient) => Promise<void>;
  },
): Promise<void> {
  const passwordResetRecipient = parsePasswordResetEmailRecipient(value);
  if (passwordResetRecipient) {
    if (!senders.sendPasswordResetEmail) {
      logger.warn("Mailjet is not configured; password reset email was not sent");
      return;
    }
    await senders.sendPasswordResetEmail(passwordResetRecipient);
    return;
  }

  const emailUpdatedRecipient = parseEmailUpdatedRecipient(value);
  if (emailUpdatedRecipient) {
    if (!senders.sendEmailUpdatedEmail) {
      logger.warn("Mailjet is not configured; email-updated email was not sent");
      return;
    }
    await senders.sendEmailUpdatedEmail(emailUpdatedRecipient);
    return;
  }

  const welcomeRecipient = parseWelcomeEmailRecipient(value);
  if (welcomeRecipient) {
    if (!senders.sendWelcomeEmail) {
      logger.warn("Mailjet is not configured; welcome email was not sent");
      return;
    }
    await senders.sendWelcomeEmail(welcomeRecipient);
    return;
  }

  const verificationRecipient = parseVerificationEmailRecipient(value);
  if (!verificationRecipient) return;
  if (!senders.sendVerificationEmail) {
    logger.warn("Mailjet is not configured; verification email was not sent");
    return;
  }
  await senders.sendVerificationEmail(verificationRecipient);
}
