/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Async HTTP handlers for administrator user CRUD operations
    Author review: Done
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

export async function listUsers(_req: Request, res: Response): Promise<void> {
  res.json(await users.listUsers());
}

export async function getUser(req: Request, res: Response): Promise<void> {
  res.json(await users.getUser(getUserIdParam(req)));
}

export async function createUser(req: Request, res: Response): Promise<void> {
  res.status(201).json(await users.createUser(req.body));
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  getActingUserId(res);
  res.json(await users.updateUser(getUserIdParam(req), req.body));
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  await users.deleteUser(getUserIdParam(req), getActingUserId(res));
  res.status(204).end();
}
