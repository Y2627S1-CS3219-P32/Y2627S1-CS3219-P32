import "dotenv/config";

/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Validated user-service environment configuration
    Author review: Done
**/
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || Buffer.byteLength(jwtSecret) < 32) {
  throw new Error("JWT_SECRET must be set to at least 32 bytes");
}

const jwtAccessTokenTtl = Number(process.env.JWT_ACCESS_TOKEN_TTL ?? 900);
if (!Number.isSafeInteger(jwtAccessTokenTtl) || jwtAccessTokenTtl <= 0) {
  throw new Error("JWT_ACCESS_TOKEN_TTL must be a positive integer number of seconds");
}

export const config = {
  port: Number(process.env.PORT ?? 3333),
  jwtSecret,
  jwtAccessTokenTtl,
};
