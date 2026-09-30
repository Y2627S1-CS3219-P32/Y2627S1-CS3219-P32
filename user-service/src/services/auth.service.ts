/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Registration validation, credential authentication, and JWT issuance
    Author review: Done
**/
import { createAccessToken, hashPassword, verifyPassword } from "../auth";
import { errorHasMessage, HttpError } from "../errors";
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

export function register(input: unknown, config: AuthConfiguration) {
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
  if (findUserByDisplayName(displayName)) {
    throw new HttpError(409, "A user with this display name already exists");
  }
  if (findUserByEmail(email)) {
    throw new HttpError(409, "A user with this email already exists");
  }

  let user;
  try {
    user = insertUser({
      name,
      displayName,
      email,
      role: "student",
      passwordHash: hashPassword(password),
    });
  } catch (error) {
    if (errorHasMessage(error, "UNIQUE constraint failed: users.email")) {
      throw new HttpError(409, "A user with this email already exists");
    }
    if (errorHasMessage(error, "users_display_name_unique")) {
      throw new HttpError(409, "A user with this display name already exists");
    }
    throw error;
  }

  return {
    token: createAccessToken(user.id, config.jwtSecret, config.accessTokenTtl),
    user,
  };
}

export function login(email: unknown, password: unknown, config: AuthConfiguration) {
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !email.trim() ||
    !password ||
    Buffer.byteLength(password) > 256
  ) {
    throw new HttpError(400, "Email and password are required");
  }

  const user = findUserByEmail(email.trim().toLowerCase());
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

export function getAuthenticatedUser(userId: number) {
  const user = findPublicUserById(userId);
  if (!user) throw new HttpError(401, "Token user no longer exists");
  return user;
}
