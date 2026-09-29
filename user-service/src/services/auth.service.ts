/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Credential authentication and JWT issuance service
    Author review: Done
**/
import { createAccessToken, hashPassword, verifyPassword } from "../auth";
import { HttpError } from "../errors";
import {
  findPublicUserById,
  findUserByEmail,
  insertUser,
} from "../repositories/users.repository";

export interface AuthConfiguration {
  jwtSecret: string;
  accessTokenTtl: number;
}

export function register(input: unknown, config: AuthConfiguration) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new HttpError(400, "Request body must be an object");
  }

  const body = input as Record<string, unknown>;
  const allowedKeys = new Set(["name", "email", "confirmEmail", "password"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new HttpError(400, "Request contains unsupported fields");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const confirmEmail = typeof body.confirmEmail === "string"
    ? body.confirmEmail.trim().toLowerCase()
    : "";
  const password = body.password;

  if (!name || name.length > 100) {
    throw new HttpError(400, "Name must be between 1 and 100 characters");
  }
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new HttpError(400, "A valid email address is required");
  }
  if (confirmEmail !== email) {
    throw new HttpError(400, "Email addresses do not match");
  }
  if (
    typeof password !== "string" ||
    Buffer.byteLength(password) < 8 ||
    Buffer.byteLength(password) > 256
  ) {
    throw new HttpError(400, "Password must be between 8 and 256 bytes");
  }
  if (findUserByEmail(email)) {
    throw new HttpError(409, "A user with this email already exists");
  }

  let user;
  try {
    user = insertUser({
      name,
      email,
      role: "student",
      passwordHash: hashPassword(password),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: users.email")) {
      throw new HttpError(409, "A user with this email already exists");
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
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
}

export function getAuthenticatedUser(userId: number) {
  const user = findPublicUserById(userId);
  if (!user) throw new HttpError(401, "Token user no longer exists");
  return user;
}
