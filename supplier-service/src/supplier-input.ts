/**AI Assistance Disclosure:
Tool: Claude Code (model: Opus 5.5), date: 2026-09-29
Scope: Request body validation for PUT /suppliers/:id.
Author review: Pending. **/

import { HttpError } from "./errors.js";

export interface SupplierInput {
  name: string;
  type: string;
  buildingName: string | null;
  floor: string | null;
  locationDescription: string | null;
  latitude: string;
  longitude: string;
  imageUrl: string | null;
}

const MAX_LENGTH = 256;

function requiredText(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${field} is required`);
  if (value.trim().length > MAX_LENGTH) throw new HttpError(400, `${field} must be at most ${MAX_LENGTH} characters`);
  return value.trim();
}

// Blank strings are stored as null.
function optionalText(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];
  if (value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, `${field} must be a string or null`);
  if (value.trim().length > MAX_LENGTH) throw new HttpError(400, `${field} must be at most ${MAX_LENGTH} characters`);
  return value.trim() || null;
}

function coordinate(body: Record<string, unknown>, field: string, limit: number): string {
  const value = body[field];
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^-?\d+(\.\d+)?$/.test(text) || Math.abs(Number(text)) > limit) {
    throw new HttpError(400, `${field} must be a number between -${limit} and ${limit}`);
  }
  return text;
}

function imageUrl(body: Record<string, unknown>): string | null {
  const value = body.imageUrl;
  if (value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, "imageUrl must be a string or null");
  if (!value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    // Reported below.
  }
  throw new HttpError(400, "imageUrl must be an http or https URL");
}

export function parseSupplierInput(body: unknown): SupplierInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }
  const fields = body as Record<string, unknown>;
  return {
    name: requiredText(fields, "name"),
    type: requiredText(fields, "type"),
    buildingName: optionalText(fields, "buildingName"),
    floor: optionalText(fields, "floor"),
    locationDescription: optionalText(fields, "locationDescription"),
    latitude: coordinate(fields, "latitude", 90),
    longitude: coordinate(fields, "longitude", 180),
    imageUrl: imageUrl(fields),
  };
}
