/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: PostgreSQL auth and profile updates, plus protected first-admin bootstrap
    Author review: Done
**/
import { createHash, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";

import { createAccessToken, hashPassword, verifyPassword } from "../auth";
import { HttpError, isPostgresUniqueViolation } from "../errors";
import { db } from "../db";
import { usersTable } from "../db/schema";
import {
  findPublicUserById,
  findUserById,
  findUserByDisplayName,
  findUserByEmail,
  insertUser,
  updateUser as persistUserUpdate,
} from "../repositories/users.repository";
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

export async function register(input: unknown, config: AuthConfiguration) {
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

  let user;
  try {
    user = await insertUser({
      name,
      displayName,
      email,
      role: "student",
      passwordHash: hashPassword(password),
    });
  } catch (error) {
    if (isPostgresUniqueViolation(error, "users_email_unique")) {
      throw new HttpError(409, "A user with this email already exists");
    }
    if (isPostgresUniqueViolation(error, "users_display_name_unique")) {
      throw new HttpError(409, "A user with this display name already exists");
    }
    throw error;
  }

  return {
    token: createAccessToken(user.id, config.jwtSecret, config.accessTokenTtl),
    user,
  };
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

  return {
    token: createAccessToken(user.id, config.jwtSecret, config.accessTokenTtl),
    user: {
      id: user.id,
      name: user.name,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
    },
  };
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
    "currentPassword",
    "newPassword",
  ]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new HttpError(400, "Request contains unsupported fields");
  }

  const updates: {
    displayName?: string;
    email?: string;
    passwordHash?: string;
  } = {};
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

  if ("currentPassword" in body || "newPassword" in body) {
    if (
      typeof body.currentPassword !== "string" ||
      !body.currentPassword ||
      typeof body.newPassword !== "string"
    ) {
      throw new HttpError(400, "Current and new passwords are required");
    }
    const currentUser = await findUserById(userId);
    if (!currentUser || !verifyPassword(body.currentPassword, currentUser.passwordHash)) {
      throw new HttpError(401, "Current password is incorrect");
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

  try {
    const user = await persistUserUpdate(userId, updates);
    if (!user) throw new HttpError(401, "Token user no longer exists");
    return user;
  } catch (error) {
    if (isPostgresUniqueViolation(error, "users_email_unique")) {
      throw new HttpError(409, "A user with this email already exists");
    }
    if (isPostgresUniqueViolation(error, "users_display_name_unique")) {
      throw new HttpError(409, "A user with this display name already exists");
    }
    throw error;
  }
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

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(3219, 1)`);
      const [admin] = await tx.select({ id: usersTable.id }).from(usersTable)
        .where(eq(usersTable.role, "admin")).limit(1);
      if (admin) {
        throw new HttpError(404, "Page not found");
      }
      const [existingEmail] = await tx.select({ id: usersTable.id }).from(usersTable)
        .where(eq(usersTable.email, email)).limit(1);
      if (existingEmail) throw new HttpError(409, "A user with this email already exists");
      const [existingDisplayName] = await tx.select({ id: usersTable.id }).from(usersTable)
        .where(sql`lower(${usersTable.displayName}) = ${displayName.toLowerCase()}`).limit(1);
      if (existingDisplayName) {
        throw new HttpError(409, "A user with this display name already exists");
      }
      await tx.insert(usersTable).values({
        name,
        displayName,
        email,
        role: "admin",
        passwordHash: hashPassword(password),
      });
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (isPostgresUniqueViolation(error, "users_email_unique")) {
      throw new HttpError(409, "A user with this email already exists");
    }
    if (isPostgresUniqueViolation(error, "users_display_name_unique")) {
      throw new HttpError(409, "A user with this display name already exists");
    }
    throw error;
  }
}

export async function ensureBootstrapAvailable(configuredSecret: string | undefined): Promise<void> {
  if (!configuredSecret) {
    throw new HttpError(404, "Page not found");
  }
  const [admin] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.role, "admin")).limit(1);
  if (admin) throw new HttpError(404, "Page not found");
}
