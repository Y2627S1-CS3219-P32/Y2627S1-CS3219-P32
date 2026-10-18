/**AI Assistance Disclosure:
Tool: Claude Code (model: Opus 5.5), date: 2026-09-29
Scope: Authentication and administrator middleware that resolves the caller through user-service GET /me.
Author review: Done.
Tool: Claude Code (model: Opus 5.5), date: 2026-10-18
Scope: Local JWT verification (verifier copied from order-service/src/auth.ts) and caller
lookup in the local user copy, replacing the user-service GET /me call.
Author review: Pending. **/

import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db } from "./db/index.js";
import { users } from "./db/schema.js";
import { HttpError } from "./errors.js";

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || Buffer.byteLength(jwtSecret) < 32) {
  throw new Error("JWT_SECRET must be set to at least 32 bytes (the same secret as user-service)");
}

export interface AuthenticatedUser {
  id: number;
  role: string;
}

function isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
  return typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "number" &&
    "role" in value &&
    typeof value.role === "string";
}

export function getAuthenticatedUser(res: Response): AuthenticatedUser {
  const user: unknown = res.locals.user;
  if (!isAuthenticatedUser(user)) throw new HttpError(401, "A valid bearer token is required");
  return user;
}

function sign(content: string, secret: string): string {
  return createHmac("sha256", secret).update(content).digest("base64url");
}

// Same token format as user-service createAccessToken: HS256 with sub = user id.
export function verifyAccessToken(token: string, nowSeconds = Math.floor(Date.now() / 1000)): number | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;

  const [encodedHeader, encodedPayload, signature] = parts as [string, string, string];
  const actual = Buffer.from(signature, "base64url");
  const expected = Buffer.from(sign(`${encodedHeader}.${encodedPayload}`, jwtSecret!), "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;

  try {
    const header: unknown = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
    const payload: unknown = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (
      typeof header !== "object" || header === null ||
      !("alg" in header) || header.alg !== "HS256" ||
      !("typ" in header) || header.typ !== "JWT" ||
      typeof payload !== "object" || payload === null ||
      !("sub" in payload) || typeof payload.sub !== "string" || !/^[1-9]\d*$/.test(payload.sub) ||
      !("exp" in payload) || typeof payload.exp !== "number" ||
      !Number.isSafeInteger(payload.exp) || payload.exp <= nowSeconds
    ) {
      return undefined;
    }
    const userId = Number(payload.sub);
    return Number.isSafeInteger(userId) ? userId : undefined;
  } catch {
    return undefined;
  }
}

// Verifies the token locally, then reads the caller's role from the local user copy:
// deleted users are rejected, and a user whose user.created event has not arrived
// yet gets a retryable 503.
export async function requireAuthentication(req: Request, res: Response, next: NextFunction): Promise<void> {
  const match = req.header("authorization")?.match(/^Bearer (\S+)$/i);
  const userId = match ? verifyAccessToken(match[1]!) : undefined;
  if (userId === undefined) throw new HttpError(401, "A valid bearer token is required");

  const [user] = await db.select({ role: users.role, deletedAt: users.deletedAt }).from(users).where(eq(users.id, userId));
  if (!user) {
    throw new HttpError(503, "Your account is still being set up. Please try again shortly.", { "retry-after": "2" });
  }
  if (user.deletedAt || user.role === null) throw new HttpError(401, "A valid bearer token is required");

  res.locals.user = { id: userId, role: user.role } satisfies AuthenticatedUser;
  next();
}

export function requireAdministrator(_req: Request, res: Response, next: NextFunction): void {
  if (getAuthenticatedUser(res).role !== "admin") {
    throw new HttpError(403, "Administrator access is required");
  }
  next();
}
