/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: JWT authentication middleware
    Author review: Done
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Reject authenticated requests from pending accounts
    Author review: Pending
**/
import type { NextFunction, Request, Response } from "express";

import { verifyAccessToken } from "../auth";
import { config } from "../config";
import { HttpError } from "../errors";
import { findUserById } from "../repositories/users.repository";

export async function requireAuthentication(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authorization = req.header("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match) {
    next(new HttpError(401, "A valid bearer token is required"));
    return;
  }

  const claims = verifyAccessToken(match[1], config.jwtSecret);
  if (!claims) {
    next(new HttpError(401, "A valid bearer token is required"));
    return;
  }

  const user = await findUserById(claims.userId);
  if (!user) {
    next(new HttpError(401, "Token user no longer exists"));
    return;
  }
  if (user.verificationStatus !== "verified") {
    next(new HttpError(403, "Account verification is required"));
    return;
  }

  res.locals.userId = claims.userId;
  next();
}
