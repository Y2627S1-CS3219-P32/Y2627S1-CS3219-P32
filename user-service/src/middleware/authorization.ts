/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Async database-backed role authorization middleware
    Author review: Done
**/
import type { NextFunction, Request, Response } from "express";

import { getAuthenticatedUser } from "../services/auth.service";
import { HttpError } from "../errors";

export async function requireAdministrator(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId: unknown = res.locals.userId;
  if (typeof userId !== "number") {
    next(new HttpError(401, "A valid bearer token is required"));
    return;
  }

  try {
    const user = await getAuthenticatedUser(userId);
    if (user.role !== "admin") {
      next(new HttpError(403, "Administrator access is required"));
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}
