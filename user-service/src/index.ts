/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-28
    Scope: JWT login and protected user-service endpoints
    Author review: Pending
**/

import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';

import { createAccessToken, verifyAccessToken, verifyPassword } from './auth';
import { getAllUsers, getPublicUserById, getUserByEmail } from './db';

const app = express();
const port = Number(process.env.PORT ?? 3333);
const jwtSecret = process.env.JWT_SECRET;
const jwtAccessTokenTtl = Number(process.env.JWT_ACCESS_TOKEN_TTL ?? 900);

if (!jwtSecret || Buffer.byteLength(jwtSecret) < 32) {
  throw new Error("JWT_SECRET must be set to at least 32 bytes");
}
if (!Number.isSafeInteger(jwtAccessTokenTtl) || jwtAccessTokenTtl <= 0) {
  throw new Error("JWT_ACCESS_TOKEN_TTL must be a positive integer number of seconds");
}

app.use(express.json({ limit: "10kb" }));

function requireAdministrator(_req: Request, res: Response, next: NextFunction): void {
  const userId: unknown = res.locals.userId;
  if (typeof userId !== "number") {
    res.status(401).json({ error: "A valid bearer token is required" });
    return;
  }

  const user = getPublicUserById(userId);
  if (!user) {
    res.status(401).json({ error: "Token user no longer exists" });
    return;
  }
  if (user.role !== "admin") {
    res.status(403).json({ error: "Administrator access is required" });
    return;
  }

  next();
}

app.get('/health', (_req, res) => {
  res.json({ status: "ok" });
});

app.get('/users', requireAuthentication, requireAdministrator, (_req, res) => {
  res.json(getAllUsers());
});

app.post('/login', (req, res) => {
  const { email, password } = req.body ?? {};
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !email.trim() ||
    !password ||
    Buffer.byteLength(password) > 256
  ) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const user = getUserByEmail(email.trim().toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const token = createAccessToken(user.id, jwtSecret, jwtAccessTokenTtl);
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

function requireAuthentication(req: Request, res: Response, next: NextFunction): void {
  const authorization = req.header("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match) {
    res.status(401).json({ error: "A valid bearer token is required" });
    return;
  }

  const claims = verifyAccessToken(match[1], jwtSecret);
  if (!claims) {
    res.status(401).json({ error: "A valid bearer token is required" });
    return;
  }

  res.locals.userId = claims.userId;
  next();
}

app.get('/me', requireAuthentication, (_req, res) => {
  const userId: unknown = res.locals.userId;
  if (typeof userId !== "number") {
    res.status(401).json({ error: "A valid bearer token is required" });
    return;
  }

  const user = getPublicUserById(userId);
  if (!user) {
    res.status(401).json({ error: "Token user no longer exists" });
    return;
  }
  res.json(user);
});

app.listen(port, () => {
  console.log(`User service listening on port ${port}`);
});