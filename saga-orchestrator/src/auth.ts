/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
 * Scope: Authentication for internal routes (Pub/Sub push, Cloud Scheduler): Google OIDC
 * tokens, or a shared secret for local development, as in order-service/src/auth.ts.
 * Author review: Pending.
 */
import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import { config } from "./config.js";
import { HttpError } from "./errors.js";

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
