/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: PostgreSQL auth and profile updates, plus protected first-admin bootstrap
    Author review: Done
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Registration publishes user.created for mail-service to consume
    Author review: Pending
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Generate verification codes and verify accounts
    Author review: Pending
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Gate access on verification and publish user.verified after successful verification
    Author review: Pending
**/
import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";

import { createAccessToken, hashPassword, verifyPassword } from "../auth";
import { HttpError } from "../errors";
import { db } from "../db";
import {
  passwordResetTokensTable,
  userBootstrapReservationsTable,
  usersTable,
  type User,
} from "../db/schema";
import {
  publishPasswordResetRequest,
  publishUserEvent,
  userSnapshot,
} from "../events/user-events";
import {
  findPublicUserById,
  findUserById,
  findUserByDisplayName,
  findUserByEmail,
  invalidatePasswordResetToken,
  reserveUserId,
} from "../repositories/users.repository";
import { createVerificationCode, verificationCodeMatches } from "../verification";
import {
  createPasswordResetToken,
  hashPasswordResetToken,
  PASSWORD_RESET_TTL_MS,
} from "../password-reset";
import {
  validateDisplayName,
  validateRegistrationPassword,
  validateUniversityEmail,
} from "../registration-validation";

export interface AuthConfiguration {
  jwtSecret: string;
  accessTokenTtl: number;
  bootstrapSecret?: string;
}

function toPublicUser(user: User) {
  const { id, name, displayName, email, role, verificationStatus } = user;
  return { id, name, displayName, email, role, verificationStatus };
}

export async function register(input: unknown) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new HttpError(400, "Request body must be an object");
  }

  const body = input as Record<string, unknown>;
  const allowedKeys = new Set(["name", "displayName", "email", "confirmEmail", "password"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new HttpError(400, "Request contains unsupported fields");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const displayName = validateDisplayName(body.displayName);
  const email = validateUniversityEmail(body.email);
  const confirmEmail = typeof body.confirmEmail === "string"
    ? body.confirmEmail.trim().toLowerCase()
    : "";
  const password = validateRegistrationPassword(body.password);

  if (!name || name.length > 100) {
    throw new HttpError(400, "Name must be between 1 and 100 characters");
  }
  if (confirmEmail !== email) {
    throw new HttpError(400, "Email addresses do not match");
  }
  if (await findUserByDisplayName(displayName)) {
    throw new HttpError(409, "A user with this display name already exists");
  }
  if (await findUserByEmail(email)) {
    throw new HttpError(409, "A user with this email already exists");
  }

  const user: User = {
    id: await reserveUserId(),
    name,
    displayName,
    email,
    role: "student",
    passwordHash: hashPassword(password),
    verificationStatus: "pending_verification",
    verificationCode: createVerificationCode(),
    verificationPurpose: "registration",
  };
  await publishUserEvent({ type: "user.created", user: userSnapshot(user) }, user.id);

  return { user: toPublicUser(user) };
}

export async function login(email: unknown, password: unknown, config: AuthConfiguration) {
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !email.trim() ||
    !password ||
    Buffer.byteLength(password) > 256
  ) {
    throw new HttpError(400, "Email and password are required");
  }

  const user = await findUserByEmail(email.trim().toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new HttpError(401, "Invalid email or password");
  }
  if (user.verificationStatus !== "verified") {
    throw new HttpError(403, "Your account is pending verification");
  }

  return {
    token: createAccessToken(user.id, config.jwtSecret, config.accessTokenTtl),
    user: {
      id: user.id,
      name: user.name,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      verificationStatus: user.verificationStatus,
    },
  };
}

export async function verifyUser(input: unknown) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new HttpError(400, "Request body must be an object");
  }
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "email" && key !== "verificationCode")) {
    throw new HttpError(400, "Request contains unsupported fields");
  }
  if (typeof body.email !== "string" || typeof body.verificationCode !== "string") {
    throw new HttpError(400, "Email and verification code are required");
  }
  const email = body.email.trim().toLowerCase();
  const code = body.verificationCode.trim();
  if (!email || !/^\d{6}$/.test(code)) {
    throw new HttpError(400, "Invalid email or verification code");
  }

  const user = await findUserByEmail(email);
  if (!user || user.verificationStatus !== "pending_verification") {
    throw new HttpError(400, "Invalid email or verification code");
  }
  if (!user.verificationCode || !verificationCodeMatches(user.verificationCode, code)) {
    throw new HttpError(400, "Invalid email or verification code");
  }

  const verifiedUser: User = {
    ...user,
    verificationStatus: "verified",
    verificationCode: null,
    verificationPurpose: null,
  };
  await publishUserEvent(
    {
      type: "user.verified",
      user: userSnapshot(verifiedUser),
      verificationPurpose: user.verificationPurpose ?? "registration",
    },
    user.id,
  );
  return toPublicUser(verifiedUser);
}

export async function requestPasswordReset(input: unknown): Promise<{ message: string }> {
  const message = "If an account exists for that email, a password reset link will be sent.";
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { message };

  const emailValue = (input as Record<string, unknown>).email;
  if (typeof emailValue !== "string") return { message };
  const email = emailValue.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { message };

  const user = await findUserByEmail(email);
  if (!user || user.verificationStatus !== "verified") return { message };

  const resetToken = createPasswordResetToken();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  await db.insert(passwordResetTokensTable).values({
    userId: user.id,
    tokenHash: hashPasswordResetToken(resetToken),
    expiresAt,
  }).onConflictDoUpdate({
    target: passwordResetTokensTable.userId,
    set: {
      tokenHash: hashPasswordResetToken(resetToken),
      expiresAt,
    },
  });
  await publishPasswordResetRequest({
    userId: user.id,
    email: user.email,
    name: user.name,
    resetToken,
  });
  return { message };
}

export async function resetPassword(input: unknown): Promise<{ message: string }> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new HttpError(400, "A valid reset link and new password are required");
  }
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "token" && key !== "password")) {
    throw new HttpError(400, "Request contains unsupported fields");
  }
  if (
    typeof body.token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(body.token) ||
    typeof body.password !== "string"
  ) {
    throw new HttpError(400, "A valid reset link and new password are required");
  }
  const password = validateRegistrationPassword(body.password);
  const [resetToken] = await db.delete(passwordResetTokensTable)
    .where(and(
      eq(passwordResetTokensTable.tokenHash, hashPasswordResetToken(body.token)),
      gt(passwordResetTokensTable.expiresAt, new Date()),
    ))
    .returning({ userId: passwordResetTokensTable.userId });
  if (!resetToken) {
    throw new HttpError(400, "This password reset link is invalid or has expired.");
  }

  const user = await findUserById(resetToken.userId);
  if (!user || user.verificationStatus !== "verified") {
    throw new HttpError(400, "This password reset link is invalid or has expired.");
  }

  const updatedUser: User = { ...user, passwordHash: hashPassword(password) };
  await publishUserEvent({ type: "user.updated", user: userSnapshot(updatedUser) }, user.id);
  return { message: "Your password has been reset. You can now sign in." };
}

export async function getAuthenticatedUser(userId: number) {
  const user = await findPublicUserById(userId);
  if (!user) throw new HttpError(401, "Token user no longer exists");
  return user;
}

export async function updateAuthenticatedUser(userId: number, input: unknown) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new HttpError(400, "Request body must be an object");
  }

  const body = input as Record<string, unknown>;
  const allowedKeys = new Set([
    "displayName",
    "email",
    "confirmEmail",
    "newPassword",
    "confirmNewPassword",
  ]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new HttpError(400, "Request contains unsupported fields");
  }

  const updates: {
    displayName?: string;
    email?: string;
    passwordHash?: string;
    verificationStatus?: User["verificationStatus"];
    verificationCode?: string | null;
    verificationPurpose?: User["verificationPurpose"];
  } = {};
  let currentUser: User | undefined;
  if ("displayName" in body) {
    updates.displayName = validateDisplayName(body.displayName);
  }
  if ("email" in body) {
    updates.email = validateUniversityEmail(body.email);
    const confirmEmail = typeof body.confirmEmail === "string"
      ? body.confirmEmail.trim().toLowerCase()
      : "";
    if (confirmEmail !== updates.email) {
      throw new HttpError(400, "Email addresses do not match");
    }
  } else if ("confirmEmail" in body) {
    throw new HttpError(400, "An email address is required for email confirmation");
  }

  if ("newPassword" in body || "confirmNewPassword" in body) {
    if (
      typeof body.newPassword !== "string" ||
      typeof body.confirmNewPassword !== "string"
    ) {
      throw new HttpError(400, "New password and confirmation are required");
    }
    currentUser = await findUserById(userId);
    if (!currentUser) {
      throw new HttpError(401, "Token user no longer exists");
    }
    if (body.newPassword !== body.confirmNewPassword) {
      throw new HttpError(400, "New passwords do not match");
    }
    const newPassword = validateRegistrationPassword(body.newPassword);
    if (verifyPassword(newPassword, currentUser.passwordHash)) {
      throw new HttpError(400, "New password must be different from the current password");
    }
    updates.passwordHash = hashPassword(newPassword);
  }

  if (Object.keys(updates).length === 0) {
    throw new HttpError(400, "Provide at least one profile field to update");
  }

  if (updates.displayName) {
    const existing = await findUserByDisplayName(updates.displayName);
    if (existing && existing.id !== userId) {
      throw new HttpError(409, "A user with this display name already exists");
    }
  }

  if (updates.email) {
    const existing = await findUserByEmail(updates.email);
    if (existing && existing.id !== userId) {
      throw new HttpError(409, "A user with this email already exists");
    }
  }

  currentUser ??= await findUserById(userId);
  if (!currentUser) throw new HttpError(401, "Token user no longer exists");
  if (updates.email && updates.email !== currentUser.email) {
    updates.verificationStatus = "pending_verification";
    updates.verificationCode = createVerificationCode();
    updates.verificationPurpose = "email_update";
  }

  const user: User = { ...currentUser, ...updates };
  if (updates.passwordHash || (updates.email && updates.email !== currentUser.email)) {
    await invalidatePasswordResetToken(userId);
  }
  await publishUserEvent({ type: "user.updated", user: userSnapshot(user) }, userId);
  return toPublicUser(user);
}

export async function bootstrapAdministrator(
  suppliedSecret: unknown,
  input: unknown,
  configuredSecret: string | undefined,
): Promise<void> {
  if (!configuredSecret) {
    throw new HttpError(404, "Page not found");
  }

  if (
    typeof suppliedSecret !== "string" ||
    !timingSafeEqual(
      createHash("sha256").update(suppliedSecret).digest(),
      createHash("sha256").update(configuredSecret).digest(),
    )
  ) {
    throw new HttpError(403, "Invalid administrator setup secret");
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new HttpError(400, "Request body must be an object");
  }

  const body = input as Record<string, unknown>;
  const allowedKeys = new Set(["name", "displayName", "email", "confirmEmail", "password"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new HttpError(400, "Request contains unsupported fields");
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const displayName = validateDisplayName(body.displayName);
  const email = validateUniversityEmail(body.email);
  const confirmEmail = typeof body.confirmEmail === "string"
    ? body.confirmEmail.trim().toLowerCase()
    : "";
  const password = validateRegistrationPassword(body.password);
  if (!name || name.length > 100) {
    throw new HttpError(400, "Name must be between 1 and 100 characters");
  }
  if (confirmEmail !== email) {
    throw new HttpError(400, "Email addresses do not match");
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(3219, 1)`);
    const [admin] = await tx.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.role, "admin")).limit(1);
    if (admin) {
      throw new HttpError(404, "Page not found");
    }
    const [reservation] = await tx.select({ id: userBootstrapReservationsTable.id })
      .from(userBootstrapReservationsTable)
      .where(eq(userBootstrapReservationsTable.id, 1))
      .limit(1);
    if (reservation) throw new HttpError(404, "Page not found");
    const [existingEmail] = await tx.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.email, email)).limit(1);
    if (existingEmail) throw new HttpError(409, "A user with this email already exists");
    const [existingDisplayName] = await tx.select({ id: usersTable.id }).from(usersTable)
      .where(sql`lower(${usersTable.displayName}) = ${displayName.toLowerCase()}`).limit(1);
    if (existingDisplayName) {
      throw new HttpError(409, "A user with this display name already exists");
    }
    const user: User = {
      id: await reserveUserId(),
      name,
      displayName,
      email,
      role: "admin",
      passwordHash: hashPassword(password),
      verificationStatus: "pending_verification",
      verificationCode: createVerificationCode(),
      verificationPurpose: "registration",
    };
    await publishUserEvent({ type: "user.created", user: userSnapshot(user) }, user.id);
    await tx.insert(userBootstrapReservationsTable).values({ id: 1, userId: user.id });
  });
}

export async function ensureBootstrapAvailable(configuredSecret: string | undefined): Promise<void> {
  if (!configuredSecret) {
    throw new HttpError(404, "Page not found");
  }
  const [admin] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.role, "admin")).limit(1);
  if (admin) throw new HttpError(404, "Page not found");
  const [reservation] = await db.select({ id: userBootstrapReservationsTable.id })
    .from(userBootstrapReservationsTable)
    .where(eq(userBootstrapReservationsTable.id, 1))
    .limit(1);
  if (reservation) throw new HttpError(404, "Page not found");
}
