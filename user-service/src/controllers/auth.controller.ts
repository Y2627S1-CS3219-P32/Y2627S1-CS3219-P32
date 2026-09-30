/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Async HTTP handlers for login, registration, and current-user endpoints
    Author review: Done
**/
import type { Request, Response } from "express";

import { config } from "../config";
import { getAuthenticatedUser, login, register } from "../services/auth.service";
import { HttpError } from "../errors";

export async function postLogin(req: Request, res: Response): Promise<void> {
  const body: unknown = req.body;
  const credentials = typeof body === "object" && body !== null
    ? body as Record<string, unknown>
    : {};
  res.json(await login(credentials.email, credentials.password, {
    jwtSecret: config.jwtSecret,
    accessTokenTtl: config.jwtAccessTokenTtl,
  }));
}

export async function postRegister(req: Request, res: Response): Promise<void> {
  res.status(201).json(await register(req.body, {
    jwtSecret: config.jwtSecret,
    accessTokenTtl: config.jwtAccessTokenTtl,
  }));
}

export async function getCurrentUser(_req: Request, res: Response): Promise<void> {
  const userId: unknown = res.locals.userId;
  if (typeof userId !== "number") throw new HttpError(401, "A valid bearer token is required");
  res.json(await getAuthenticatedUser(userId));
}
