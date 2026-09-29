/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: HTTP handlers for login and current-user endpoints
    Author review: Pending
**/
import type { Request, Response } from "express";

import { config } from "../config";
import { getAuthenticatedUser, login } from "../services/auth.service";
import { HttpError } from "../errors";

export function postLogin(req: Request, res: Response): void {
  const body: unknown = req.body;
  const credentials = typeof body === "object" && body !== null
    ? body as Record<string, unknown>
    : {};
  res.json(login(credentials.email, credentials.password, {
    jwtSecret: config.jwtSecret,
    accessTokenTtl: config.jwtAccessTokenTtl,
  }));
}

export function getCurrentUser(_req: Request, res: Response): void {
  const userId: unknown = res.locals.userId;
  if (typeof userId !== "number") throw new HttpError(401, "A valid bearer token is required");
  res.json(getAuthenticatedUser(userId));
}
