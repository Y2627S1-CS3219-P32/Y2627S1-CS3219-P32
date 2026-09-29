/**AI Assistance Disclosure:
Tool: Claude Code (model: Opus 5.5), date: 2026-09-29
Scope: Authentication and administrator middleware that resolves the caller through user-service GET /me.
Author review: Pending. **/

import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./errors.js";

const userServiceBaseUrl = process.env.USER_SERVICE_BASE_URL ?? "http://127.0.0.1:3333";

export interface AuthenticatedUser {
  id: number;
  role: string;
}

function isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
  return typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "number" &&
    "role" in value &&
    typeof value.role === "string";
}

export function getAuthenticatedUser(res: Response): AuthenticatedUser {
  const user: unknown = res.locals.user;
  if (!isAuthenticatedUser(user)) throw new HttpError(401, "A valid bearer token is required");
  return user;
}

export async function requireAuthentication(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authorization = req.header("authorization");
  if (!authorization || !/^Bearer \S+$/i.test(authorization)) {
    throw new HttpError(401, "A valid bearer token is required");
  }

  let response: globalThis.Response;
  try {
    response = await fetch(new URL("/me", userServiceBaseUrl), {
      headers: { authorization },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new HttpError(502, "User service is unavailable");
  }

  if (response.status === 401 || response.status === 404) {
    throw new HttpError(401, "A valid bearer token is required");
  }
  if (!response.ok) throw new HttpError(502, "User service is unavailable");

  const user: unknown = await response.json().catch(() => undefined);
  if (!isAuthenticatedUser(user)) throw new HttpError(502, "User service returned an invalid user");

  res.locals.user = { id: user.id, role: user.role } satisfies AuthenticatedUser;
  next();
}

export function requireAdministrator(_req: Request, res: Response, next: NextFunction): void {
  if (getAuthenticatedUser(res).role !== "admin") {
    throw new HttpError(403, "Administrator access is required");
  }
  next();
}
