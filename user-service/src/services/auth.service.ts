/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Async PostgreSQL-backed registration, authentication, and JWT issuance
    Author review: Done
**/
import { createAccessToken, hashPassword, verifyPassword } from "../auth";
import { HttpError, isPostgresUniqueViolation } from "../errors";
import {
  findPublicUserById,
  findUserByDisplayName,
  findUserByEmail,
  insertUser,
} from "../repositories/users.repository";
import {
  validateDisplayName,
  validateRegistrationPassword,
  validateUniversityEmail,
} from "../registration-validation";

export interface AuthConfiguration {
  jwtSecret: string;
  accessTokenTtl: number;
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
