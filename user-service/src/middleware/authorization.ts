/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Role-based authorization middleware
    Author review: Pending
**/
import type { NextFunction, Request, Response } from "express";

import { getAuthenticatedUser } from "../services/auth.service";
import { HttpError } from "../errors";

export function requireAdministrator(_req: Request, res: Response, next: NextFunction): void {
  const userId: unknown = res.locals.userId;
  if (typeof userId !== "number") {
    next(new HttpError(401, "A valid bearer token is required"));
    return;
  }

  try {
    const user = getAuthenticatedUser(userId);
    if (user.role !== "admin") {
      next(new HttpError(403, "Administrator access is required"));
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}
