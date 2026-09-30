/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Validated administrator user CRUD including display names
    Author review: Done
**/
import { hashPassword } from "../auth";
import type { PublicUser, User } from "../db/schema";
import { errorHasMessage, HttpError } from "../errors";
import {
  countAdministrators,
  deleteUser as removeUser,
  findAllUsers,
  findPublicUserById,
  findUserByDisplayName,
  findUserByEmail,
  insertUser,
  updateUser as persistUserUpdate,
} from "../repositories/users.repository";
import { validateDisplayName } from "../registration-validation";

type UserFields = Pick<User, "name" | "email" | "role"> & Partial<Pick<User, "displayName">>;

function parseUserId(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new HttpError(400, "User id must be a positive integer");
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new HttpError(400, "User id must be a positive integer");
  return id;
}

function normalizeFields(input: unknown, creating: boolean): Partial<UserFields> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new HttpError(400, "Request body must be an object");
  }

  const body = input as Record<string, unknown>;
  const fields: Partial<UserFields> = {};

  if (creating || "name" in body) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 100) {
      throw new HttpError(400, "Name must be between 1 and 100 characters");
    }
    fields.name = body.name.trim();
  }

  if (creating || "email" in body) {
    if (
      typeof body.email !== "string" ||
      body.email.trim().length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
    ) {
      throw new HttpError(400, "A valid email address is required");
    }
    fields.email = body.email.trim().toLowerCase();
  }

  if ("displayName" in body) {
    fields.displayName = validateDisplayName(body.displayName);
  }

  if ("role" in body) {
    if (body.role !== "student" && body.role !== "admin") {
      throw new HttpError(400, "Role must be either student or admin");
    }
    fields.role = body.role;
  } else if (creating) {
    fields.role = "student";
  }

  const allowedKeys = new Set(["name", "displayName", "email", "role", "password"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new HttpError(400, "Request contains unsupported fields");
  }

  return fields;
}

function getPassword(input: unknown, creating: boolean): string | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new HttpError(400, "Request body must be an object");
  }

  const password = (input as Record<string, unknown>).password;
  if (password === undefined && !creating) return undefined;
  if (
    typeof password !== "string" ||
    Buffer.byteLength(password) < 8 ||
    Buffer.byteLength(password) > 256
  ) {
    throw new HttpError(400, "Password must be between 8 and 256 bytes");
  }
  return password;
}

function ensureUniqueEmail(email: string, excludedId?: number): void {
  const existing = findUserByEmail(email);
  if (existing && existing.id !== excludedId) {
    throw new HttpError(409, "A user with this email already exists");
  }
}

function ensureUniqueDisplayName(displayName: string, excludedId?: number): void {
  const existing = findUserByDisplayName(displayName);
  if (existing && existing.id !== excludedId) {
    throw new HttpError(409, "A user with this display name already exists");
  }
}

export function listUsers(): PublicUser[] {
  return findAllUsers();
}

export function getUser(idParam: string): PublicUser {
  const user = findPublicUserById(parseUserId(idParam));
  if (!user) throw new HttpError(404, "User not found");
  return user;
}

export function createUser(input: unknown): PublicUser {
  const fields = normalizeFields(input, true);
  const password = getPassword(input, true);
  if (!fields.name || !fields.email || !fields.role || !password) {
    throw new Error("Validated create-user fields are missing");
  }
  ensureUniqueEmail(fields.email);
  if (fields.displayName) ensureUniqueDisplayName(fields.displayName);
  try {
    return insertUser({
      name: fields.name,
      ...(fields.displayName ? { displayName: fields.displayName } : {}),
      email: fields.email,
      role: fields.role,
      passwordHash: hashPassword(password),
    });
  } catch (error) {
    if (isEmailConflict(error)) throw new HttpError(409, "A user with this email already exists");
    if (isDisplayNameConflict(error)) {
      throw new HttpError(409, "A user with this display name already exists");
    }
    throw error;
  }
}

export function updateUser(idParam: string, input: unknown): PublicUser {
  const id = parseUserId(idParam);
  const current = findPublicUserById(id);
  if (!current) throw new HttpError(404, "User not found");

  const fields = normalizeFields(input, false);
  const password = getPassword(input, false);
  if (Object.keys(fields).length === 0 && password === undefined) {
    throw new HttpError(400, "Provide at least one field to update");
  }
  if (
    current.role === "admin" &&
    fields.role === "student" &&
    countAdministrators() === 1
  ) {
    throw new HttpError(409, "The last administrator cannot be demoted");
  }
  if (fields.email) ensureUniqueEmail(fields.email, id);
  if (fields.displayName) ensureUniqueDisplayName(fields.displayName, id);

  const updates: Partial<Pick<User, "name" | "displayName" | "email" | "role" | "passwordHash">> = { ...fields };
  if (password !== undefined) updates.passwordHash = hashPassword(password);
  try {
    const user = persistUserUpdate(id, updates);
    if (!user) throw new HttpError(404, "User not found");
    return user;
  } catch (error) {
    if (isEmailConflict(error)) throw new HttpError(409, "A user with this email already exists");
    if (isDisplayNameConflict(error)) {
      throw new HttpError(409, "A user with this display name already exists");
    }
    throw error;
  }
}

export function deleteUser(idParam: string, actingUserId: number): void {
  const id = parseUserId(idParam);
  const user = findPublicUserById(id);
  if (!user) throw new HttpError(404, "User not found");
  if (id === actingUserId) throw new HttpError(409, "You cannot delete your own account");
  if (user.role === "admin" && countAdministrators() === 1) {
    throw new HttpError(409, "The last administrator cannot be deleted");
  }
  if (!removeUser(id)) throw new HttpError(404, "User not found");
}

function isEmailConflict(error: unknown): boolean {
  return errorHasMessage(error, "UNIQUE constraint failed: users.email");
}

function isDisplayNameConflict(error: unknown): boolean {
  return errorHasMessage(error, "users_display_name_unique");
}
