/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Async auth, profile-update, and first-administrator bootstrap handlers
    Author review: Done
**/
import type { Request, Response } from "express";

import { config } from "../config";
import {
  getAuthenticatedUser,
  bootstrapAdministrator,
  ensureBootstrapAvailable,
  login,
  register,
  updateAuthenticatedUser,
} from "../services/auth.service";
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

export async function patchCurrentUser(req: Request, res: Response): Promise<void> {
  const userId: unknown = res.locals.userId;
  if (typeof userId !== "number") throw new HttpError(401, "A valid bearer token is required");
  res.json(await updateAuthenticatedUser(userId, req.body));
}

export async function postBootstrapAdministrator(req: Request, res: Response): Promise<void> {
  await bootstrapAdministrator(
    req.header("x-bootstrap-secret"),
    req.body,
    config.bootstrapSecret,
  );
  res.status(201).json({ message: "Administrator account created. You can now sign in." });
}

export async function getBootstrapAvailability(_req: Request, res: Response): Promise<void> {
  await ensureBootstrapAvailable(config.bootstrapSecret);
  res.json({ available: true });
}
