/**AI Assistance Disclosure:
Tool: Claude Code (model: Opus 5.5), date: 2026-10-15
Scope: Shared UUID route parameter check, moved out of the supplier routes.
Author review: Pending. **/

import type { Request } from "express";
import { HttpError } from "./errors.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A malformed id cannot match a row, and would otherwise fail the uuid cast.
export function getUuidParam(req: Request, notFoundMessage: string): string {
  const id = req.params.id;
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) throw new HttpError(404, notFoundMessage);
  return id;
}
