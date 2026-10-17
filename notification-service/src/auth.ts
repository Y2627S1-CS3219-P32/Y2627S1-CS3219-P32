/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Local JWT verification (as in order-service/src/auth.ts) and short-lived,
 * single-use WebSocket tickets signed with a secret shared by all instances.
 * Author review: Pending.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

const nowSeconds = () => Math.floor(Date.now() / 1000);

function signatureMatches(content: string, signature: string, secret: string): boolean {
  const actual = Buffer.from(signature, "base64url");
  const expected = createHmac("sha256", secret).update(content).digest();
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function decodeJson(part: string): unknown {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

export interface AccessToken {
  userId: number;
  expiresAt: number;
}

// Same token format as user-service createAccessToken: HS256 with sub = user id.
export function verifyAccessToken(token: string, now = nowSeconds()): AccessToken | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  const [header, payload, signature] = parts as [string, string, string];
  if (!signatureMatches(`${header}.${payload}`, signature, config.jwtSecret)) return undefined;
  try {
    const head = decodeJson(header);
    const body = decodeJson(payload);
    if (
      typeof head !== "object" || head === null || !("alg" in head) || head.alg !== "HS256" ||
      !("typ" in head) || head.typ !== "JWT" ||
      typeof body !== "object" || body === null ||
      !("sub" in body) || typeof body.sub !== "string" || !/^[1-9]\d*$/.test(body.sub) ||
      !("exp" in body) || typeof body.exp !== "number" || !Number.isSafeInteger(body.exp) || body.exp <= now
    ) {
      return undefined;
    }
    const userId = Number(body.sub);
    return Number.isSafeInteger(userId) ? { userId, expiresAt: body.exp } : undefined;
  } catch {
    return undefined;
  }
}

// A ticket carries the user id and the JWT's expiry, so the socket can be closed when
// the session would have ended.
export function issueTicket(token: AccessToken, now = nowSeconds()): string {
  const payload = Buffer.from(JSON.stringify({
    u: token.userId,
    s: token.expiresAt,
    e: now + config.ticketTtlSeconds,
    n: randomBytes(16).toString("base64url"),
  })).toString("base64url");
  return `${payload}.${createHmac("sha256", config.ticketSecret).update(payload).digest("base64url")}`;
}

// Nonces of redeemed tickets, kept until the ticket would have expired anyway.
const redeemed = new Map<string, number>();

export function redeemTicket(ticket: string, now = nowSeconds()): AccessToken | undefined {
  const [payload, signature, extra] = ticket.split(".");
  if (!payload || !signature || extra !== undefined) return undefined;
  if (!signatureMatches(payload, signature, config.ticketSecret)) return undefined;
  try {
    const body = decodeJson(payload) as Record<string, unknown>;
    const { u, s, e, n } = body;
    if (
      typeof u !== "number" || !Number.isSafeInteger(u) || u <= 0 ||
      typeof s !== "number" || typeof e !== "number" || typeof n !== "string" ||
      e <= now || s <= now || redeemed.has(n)
    ) {
      return undefined;
    }
    for (const [nonce, expiry] of redeemed) if (expiry <= now) redeemed.delete(nonce);
    redeemed.set(n, e);
    return { userId: u, expiresAt: s };
  } catch {
    return undefined;
  }
}
