/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Local JWT verification (verifier copied from user-service/src/auth.ts),
 * caller lookup in the local user copy, and authentication for internal routes
 * (Google OIDC tokens, or a shared secret for local development).
 * Author review: Pending.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { users } from "./db/schema.js";
import { HttpError } from "./errors.js";

function sign(content: string): string {
  return createHmac("sha256", config.jwtSecret).update(content).digest("base64url");
}

// Same token format as user-service createAccessToken: HS256 with sub = user id.
export function verifyAccessToken(token: string, nowSeconds = Math.floor(Date.now() / 1000)): number | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;

  const [encodedHeader, encodedPayload, signature] = parts as [string, string, string];
  const actual = Buffer.from(signature, "base64url");
  const expected = Buffer.from(sign(`${encodedHeader}.${encodedPayload}`), "base64url");
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

// Verifies the token locally, then checks the caller in the local user copy:
// deleted users are rejected, and a user whose user.created event has not arrived
// yet gets a retryable 503.
export async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const match = req.header("authorization")?.match(/^Bearer (\S+)$/i);
  const userId = match ? verifyAccessToken(match[1]!) : undefined;
  if (userId === undefined) throw new HttpError(401, "A valid bearer token is required");

  const [user] = await db.select({ deletedAt: users.deletedAt }).from(users).where(eq(users.id, userId));
  if (!user) {
    throw new HttpError(503, "Your account is still being set up. Please try again shortly.", { "retry-after": "2" });
  }
  if (user.deletedAt) throw new HttpError(401, "A valid bearer token is required");

  res.locals.userId = userId;
  next();
}

export function getUserId(res: Response): number {
  const userId: unknown = res.locals.userId;
  if (typeof userId !== "number") throw new HttpError(401, "A valid bearer token is required");
  return userId;
}

function secretMatches(supplied: unknown): boolean {
  if (!config.internalSharedSecret || typeof supplied !== "string") return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(config.internalSharedSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const googleClient = new OAuth2Client();

// For Pub/Sub push subscriptions and Cloud Scheduler, which cannot send user JWTs.
export async function requireInternal(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (secretMatches(req.header("x-internal-secret")) || secretMatches(req.query.token)) {
    next();
    return;
  }

  const match = req.header("authorization")?.match(/^Bearer (\S+)$/i);
  if (match && config.internalAudience && config.internalInvokerEmails.length > 0) {
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: match[1]!, audience: config.internalAudience });
      const payload = ticket.getPayload();
      if (payload?.email_verified && payload.email && config.internalInvokerEmails.includes(payload.email)) {
        next();
        return;
      }
    } catch {
      // Reported below.
    }
  }
  throw new HttpError(401, "Internal authentication is required");
}
