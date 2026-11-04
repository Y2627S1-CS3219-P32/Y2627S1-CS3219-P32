import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";

function sign(content: string): Buffer {
  return createHmac("sha256", config.jwtSecret).update(content).digest();
}

export function verifyAccessToken(token: string, nowSeconds = Math.floor(Date.now() / 1000)): number | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  const [encodedHeader, encodedPayload, signature] = parts as [string, string, string];
  const actual = Buffer.from(signature, "base64url");
  const expected = sign(`${encodedHeader}.${encodedPayload}`);
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
    ) return undefined;
    const userId = Number(payload.sub);
    return Number.isSafeInteger(userId) ? userId : undefined;
  } catch {
    return undefined;
  }
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const match = req.header("authorization")?.match(/^Bearer ([^\s]+)$/);
  const userId = match ? verifyAccessToken(match[1]!) : undefined;
  if (userId === undefined) {
    res.status(401).json({ error: "A valid bearer token is required" });
    return;
  }
  res.locals.userId = userId;
  next();
}

export function getUserId(res: Response): number {
  const userId: unknown = res.locals.userId;
  if (typeof userId !== "number") throw new Error("Authenticated user id is missing");
  return userId;
}
