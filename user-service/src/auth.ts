/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Password hashing and JWT signing/verification helpers
    Author review: Pending
**/
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const PASSWORD_HASH_BYTES = 64;
const JWT_SECRET_MIN_BYTES = 32;

export interface AccessTokenClaims {
  userId: number;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, PASSWORD_HASH_BYTES).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [algorithm, salt, hash, extra] = storedHash.split("$");
  if (
    algorithm !== "scrypt" ||
    !salt ||
    !hash ||
    extra !== undefined ||
    !/^[0-9a-f]{32}$/.test(salt) ||
    !/^[0-9a-f]{128}$/.test(hash)
  ) {
    return false;
  }

  const actualHash = scryptSync(password, salt, PASSWORD_HASH_BYTES);
  const expectedHash = Buffer.from(hash, "hex");
  return timingSafeEqual(actualHash, expectedHash);
}

function sign(content: string, secret: string): string {
  if (Buffer.byteLength(secret) < JWT_SECRET_MIN_BYTES) {
    throw new Error(`JWT_SECRET must be at least ${JWT_SECRET_MIN_BYTES} bytes`);
  }

  return createHmac("sha256", secret).update(content).digest("base64url");
}

export function createAccessToken(
  userId: number,
  secret: string,
  ttlSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error("User id must be a positive safe integer");
  }
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("JWT access-token lifetime must be a positive integer");
  }
  if (!Number.isSafeInteger(nowSeconds + ttlSeconds)) {
    throw new Error("JWT expiration must be a safe integer");
  }

  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: String(userId),
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  })).toString("base64url");
  const content = `${header}.${payload}`;
  return `${content}.${sign(content, secret)}`;
}

export function verifyAccessToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): AccessTokenClaims | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;

  const [encodedHeader, encodedPayload, signature] = parts;
  const content = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = sign(content, secret);
  const actualSignature = Buffer.from(signature, "base64url");
  const expectedSignatureBuffer = Buffer.from(expectedSignature, "base64url");
  if (
    actualSignature.length !== expectedSignatureBuffer.length ||
    !timingSafeEqual(actualSignature, expectedSignatureBuffer)
  ) {
    return undefined;
  }

  try {
    const header: unknown = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
    const payload: unknown = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (
      typeof header !== "object" ||
      header === null ||
      !("alg" in header) ||
      header.alg !== "HS256" ||
      !("typ" in header) ||
      header.typ !== "JWT" ||
      typeof payload !== "object" ||
      payload === null ||
      !("sub" in payload) ||
      typeof payload.sub !== "string" ||
      !/^[1-9]\d*$/.test(payload.sub) ||
      !("exp" in payload) ||
      typeof payload.exp !== "number" ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp <= nowSeconds
    ) {
      return undefined;
    }

    const userId = Number(payload.sub);
    return Number.isSafeInteger(userId) ? { userId } : undefined;
  } catch {
    return undefined;
  }
}
