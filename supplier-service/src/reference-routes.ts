/**AI Assistance Disclosure:
Tool: Claude Code (model: Opus 5.5), date: 2026-10-15
Scope: CRUD routes shared by /types and /buildings (GET moved from index.ts; administrator-only
POST, PUT, and DELETE added).
Author review: Pending. **/

import { asc, eq } from "drizzle-orm";
import { Router } from "express";
import { requireAdministrator, requireAuthentication } from "./auth.js";
import { db } from "./db/index.js";
import { buildings, types } from "./db/schema.js";
import { HttpError } from "./errors.js";
import { getUuidParam } from "./params.js";
import { requiredText } from "./supplier-input.js";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

// Drizzle wraps driver errors, so the PostgreSQL code may sit on a nested cause.
function postgresErrorCode(error: unknown): string | undefined {
  for (let current = error, depth = 0; typeof current === "object" && current !== null && depth < 5; depth++) {
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

function parseName(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }
  return requiredText(body as Record<string, unknown>, "name");
}

// `label` names the record in error messages, such as "Supplier type" or "Building".
export function referenceRouter(table: typeof types | typeof buildings, label: string) {
  const router = Router();
  const columns = { id: table.id, name: table.name };
  const notFound = `${label} not found`;

  async function write<T>(name: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (postgresErrorCode(error) === UNIQUE_VIOLATION) throw new HttpError(409, `${label} already exists: ${name}`);
      throw error;
    }
  }

  router.get("/", requireAuthentication, async (_req, res) => {
    res.status(200).json(await db.select(columns).from(table).orderBy(asc(table.name)));
  });

  router.post("/", requireAuthentication, requireAdministrator, async (req, res) => {
    const name = parseName(req.body);
    const [created] = await write(name, () => db.insert(table).values({ name }).returning(columns));
    res.status(201).json(created);
  });

  // Suppliers reference the row by id, so a rename applies to them too.
  router.put("/:id", requireAuthentication, requireAdministrator, async (req, res) => {
    const id = getUuidParam(req, notFound);
    const name = parseName(req.body);
    const [updated] = await write(name, () => db.update(table).set({ name }).where(eq(table.id, id)).returning(columns));
    if (!updated) throw new HttpError(404, notFound);
    res.status(200).json(updated);
  });

  // Rows still used by a supplier are kept; reassign or delete those suppliers first.
  router.delete("/:id", requireAuthentication, requireAdministrator, async (req, res) => {
    const id = getUuidParam(req, notFound);
    let deleted: unknown[];
    try {
      deleted = await db.delete(table).where(eq(table.id, id)).returning({ id: table.id });
    } catch (error) {
      if (postgresErrorCode(error) === FOREIGN_KEY_VIOLATION) {
        throw new HttpError(409, `${label} is still used by a supplier`);
      }
      throw error;
    }
    if (deleted.length === 0) throw new HttpError(404, notFound);
    res.status(204).end();
  });

  return router;
}
