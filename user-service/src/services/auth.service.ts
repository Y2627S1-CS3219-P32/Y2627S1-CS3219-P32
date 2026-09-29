/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Credential authentication and JWT issuance service
    Author review: Pending
**/
import { createAccessToken, verifyPassword } from "../auth";
import { HttpError } from "../errors";
import { findPublicUserById, findUserByEmail } from "../repositories/users.repository";

export interface AuthConfiguration {
  jwtSecret: string;
  accessTokenTtl: number;
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
