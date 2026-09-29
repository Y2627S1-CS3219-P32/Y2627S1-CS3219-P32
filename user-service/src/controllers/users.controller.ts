/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: HTTP handlers for administrator user CRUD operations
    Author review: Pending
**/
import type { Request, Response } from "express";

import { HttpError } from "../errors";
import * as users from "../services/users.service";

function getActingUserId(res: Response): number {
  const userId: unknown = res.locals.userId;
  if (typeof userId !== "number") throw new HttpError(401, "A valid bearer token is required");
  return userId;
}

function getUserIdParam(req: Request): string {
  const id = req.params.id;
  if (typeof id !== "string") throw new HttpError(400, "User id must be a positive integer");
  return id;
}

export function listUsers(_req: Request, res: Response): void {
  res.json(users.listUsers());
}

export function getUser(req: Request, res: Response): void {
  res.json(users.getUser(getUserIdParam(req)));
}

export function createUser(req: Request, res: Response): void {
  res.status(201).json(users.createUser(req.body));
}

export function updateUser(req: Request, res: Response): void {
  getActingUserId(res);
  res.json(users.updateUser(getUserIdParam(req), req.body));
}

export function deleteUser(req: Request, res: Response): void {
  users.deleteUser(getUserIdParam(req), getActingUserId(res));
  res.status(204).end();
}
