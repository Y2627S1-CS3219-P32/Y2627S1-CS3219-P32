import "dotenv/config";

/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-30
    Scope: JWT and optional first-administrator bootstrap secret configuration
    Author review: Done
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: No mail settings are needed; welcome delivery runs in mail-service
    Author review: Pending
**/
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || Buffer.byteLength(jwtSecret) < 32) {
  throw new Error("JWT_SECRET must be set to at least 32 bytes");
}

const jwtAccessTokenTtl = Number(process.env.JWT_ACCESS_TOKEN_TTL ?? 900);
if (!Number.isSafeInteger(jwtAccessTokenTtl) || jwtAccessTokenTtl <= 0) {
  throw new Error("JWT_ACCESS_TOKEN_TTL must be a positive integer number of seconds");
}

const bootstrapSecret = process.env.BOOTSTRAP_SECRET;
if (bootstrapSecret && Buffer.byteLength(bootstrapSecret) < 32) {
  throw new Error("BOOTSTRAP_SECRET must be at least 32 bytes when configured");
}

export const config = {
  port: Number(process.env.PORT ?? 3333),
  jwtSecret,
  jwtAccessTokenTtl,
  bootstrapSecret,
};
