/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-30
    Scope: Server-side account registration validation rules
    Author review: Done
**/
import { HttpError } from "./errors";

const allowedEmailDomains = new Set(["u.nus.edu", "nus.edu.sg", "foc.com"]);

export function validateDisplayName(value: unknown): string {
  const displayName = typeof value === "string" ? value : "";
  if (
    displayName.length < 2 ||
    displayName.length > 50 ||
    !/^[A-Za-z](?:[A-Za-z-]*[A-Za-z])$/.test(displayName)
  ) {
    throw new HttpError(
      400,
      "Display name must be 2 to 50 characters, contain only letters and hyphens, and begin and end with a letter",
    );
  }
  return displayName;
}

export function validateUniversityEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new HttpError(400, "A valid email address is required");
  }
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (!allowedEmailDomains.has(domain)) {
    throw new HttpError(400, "Email must use u.nus.edu, nus.edu.sg, or foc.com");
  }
  return email;
}

export function validateRegistrationPassword(value: unknown): string {
  if (
    typeof value !== "string" ||
    [...value].length < 8 ||
    Buffer.byteLength(value) < 8 ||
    Buffer.byteLength(value) > 256 ||
    !/[A-Z]/.test(value) ||
    !/[a-z]/.test(value) ||
    !/[0-9]/.test(value)
  ) {
    throw new HttpError(
      400,
      "Password must be at least 8 characters, no more than 256 bytes, and contain uppercase and lowercase letters and a number",
    );
  }
  return value;
}
