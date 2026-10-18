import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { OAuth2Client } from "google-auth-library";
import { config } from "./config.js";
import { CreditError } from "./credit/types.js";
const google = new OAuth2Client();
function equal(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function verifyAccessToken(
  token: string,
  secret = config.jwtSecret,
  now = Math.floor(Date.now() / 1000),
): number | undefined {
  try {
    const parts = token.split(".");
    if (
      parts.length !== 3 ||
      !secret ||
      parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
    )
      return;
    const [header, body, signature] = parts as [string, string, string];
    if (
      !equal(
        signature,
        createHmac("sha256", secret)
          .update(`${header}.${body}`)
          .digest("base64url"),
      )
    )
      return;
    const h: unknown = JSON.parse(Buffer.from(header, "base64url").toString());
    const p: unknown = JSON.parse(Buffer.from(body, "base64url").toString());
    if (
      typeof h !== "object" ||
      h === null ||
      !("alg" in h) ||
      !("typ" in h) ||
      typeof p !== "object" ||
      p === null ||
      !("sub" in p) ||
      !("exp" in p)
    )
      return;
    if (
      h.alg !== "HS256" ||
      h.typ !== "JWT" ||
      typeof p.sub !== "string" ||
      !/^[1-9]\d*$/.test(p.sub) ||
      !Number.isSafeInteger(p.exp) ||
      typeof p.exp !== "number" ||
      p.exp <= now
    )
      return;
    const id = Number(p.sub);
    return Number.isSafeInteger(id) && id <= 2147483647 ? id : undefined;
  } catch {
    return;
  }
}
export function userId(req: Request) {
  const token = req.header("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  const id = token ? verifyAccessToken(token) : undefined;
  if (id === undefined) throw new CreditError(401, "UNAUTHORIZED");
  return id;
}
export async function internal(req: Request, push = false) {
  const supplied =
    req.header("x-internal-secret") ??
    (push && typeof req.query.token === "string" ? req.query.token : undefined);
  if (
    config.internalSharedSecret &&
    supplied &&
    equal(supplied, config.internalSharedSecret)
  )
    return;
  const token = req.header("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (token && config.internalAudience) {
    try {
      const ticket = await google.verifyIdToken({
        idToken: token,
        audience: config.internalAudience,
      });
      const p = ticket.getPayload();
      const allowed = push
        ? [config.pushInvokerEmail].filter(Boolean)
        : config.internalInvokerEmails;
      if (p?.email_verified && p.email && allowed.includes(p.email)) return;
    } catch {}
  }
  throw new CreditError(401, "UNAUTHORIZED");
}
