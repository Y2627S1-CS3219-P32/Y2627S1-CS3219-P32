/**AI Assistance Disclosure:
Tool: ChatGPT(model: GPT6), date: 2026-09-28
Scope: Express server and GET /suppliers happy-path implementation.
Author review: Prior boilerplate reviewed; route changes await review.
Tool: Claude Code (model: Opus 5.5), date: 2026-09-29
Scope: Authentication on GET /suppliers, role-based visibility of inactive suppliers,
administrator-only PUT (versioned) and DELETE (soft) /suppliers/:id, and error handling.
Author review: Done.
Tool: Claude Code (model: Opus 5.5), date: 2026-09-30
Scope: GET /types, GET /buildings, administrator-only POST /suppliers, and the shared
type/building lookup used by POST and PUT.
Author review: Done.
Tool: Claude Code (model: Opus 5.5), date: 2026-09-30
Scope: PUT updates the supplier in place (including the isActive toggle), and
DELETE removes the supplier and its operating hours.
Author review: Pending. **/

import "dotenv/config";
import { pathToFileURL } from "node:url";
import { and, asc, desc, eq, getTableColumns, ilike, sql, type SQL } from "drizzle-orm";
import express, { type ErrorRequestHandler, type Request } from "express";
import { getAuthenticatedUser, requireAdministrator, requireAuthentication } from "./auth.js";
import { db } from "./db/index.js";
import { openingHoursMatch } from "./db/opening-hours.js";
import { buildings, operatingHours, suppliers, types } from "./db/schema.js";
import { HttpError } from "./errors.js";
import { parseSupplierInput, type SupplierInput } from "./supplier-input.js";

export const app = express();
const port = 3000;

app.use(express.json({ limit: "10kb" }));

app.get("/", (_req, res) => {
  res.json({ message: "Supplier service is running" });
});

function selectSuppliers(where: SQL | undefined) {
  const isOpen = sql<boolean>`${suppliers.isActive} and ${openingHoursMatch(new Date(), "Asia/Singapore")}`;
  const { supplierTypeId, buildingId, ...supplierColumns } = getTableColumns(suppliers);

  return db
    .select({ ...supplierColumns, type: types.name, buildingName: buildings.name, isOpen })
    .from(suppliers)
    .innerJoin(types, eq(supplierTypeId, types.id))
    .leftJoin(buildings, eq(buildingId, buildings.id))
    .where(where)
    .orderBy(desc(isOpen), asc(suppliers.name), asc(suppliers.id));
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getSupplierIdParam(req: Request): string {
  const id = req.params.id;
  // A malformed id cannot match a row, and would otherwise fail the uuid cast.
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) throw new HttpError(404, "Supplier not found");
  return id;
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Maps the body's type and building names to the columns stored on a supplier row.
async function toSupplierRow(tx: Transaction, input: SupplierInput) {
  const [type] = await tx.select({ id: types.id }).from(types).where(eq(types.name, input.type));
  if (!type) throw new HttpError(400, `Unknown supplier type: ${input.type}`);

  let buildingId: string | null = null;
  if (input.buildingName) {
    const [building] = await tx.select({ id: buildings.id }).from(buildings).where(eq(buildings.name, input.buildingName));
    if (!building) throw new HttpError(400, `Unknown building: ${input.buildingName}`);
    buildingId = building.id;
  }

  return {
    name: input.name,
    supplierTypeId: type.id,
    buildingId,
    floor: input.floor,
    locationDescription: input.locationDescription,
    latitude: input.latitude,
    longitude: input.longitude,
    imageUrl: input.imageUrl,
    isActive: input.isActive,
  };
}

app.get("/types", requireAuthentication, async (_req, res) => {
  res.status(200).json(await db.select({ id: types.id, name: types.name }).from(types).orderBy(asc(types.name)));
});

app.get("/buildings", requireAuthentication, async (_req, res) => {
  res.status(200).json(await db.select({ id: buildings.id, name: buildings.name }).from(buildings).orderBy(asc(buildings.name)));
});

app.get("/suppliers", requireAuthentication, async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name.trim() : undefined;
  const type = typeof req.query.type === "string" ? req.query.type.trim() : undefined;
  // Treat LIKE metacharacters as literal search text.
  const namePattern = name ? `%${name.replace(/[\\%_]/g, "\\$&")}%` : undefined;
  const isAdmin = getAuthenticatedUser(res).role === "admin";

  const results = await selectSuppliers(and(
    namePattern ? ilike(suppliers.name, namePattern) : undefined,
    type ? eq(types.name, type) : undefined,
    isAdmin ? undefined : eq(suppliers.isActive, true),
  ));

  res.status(200).json(results);
});

// New suppliers start active, with no operating hours (so they show as closed).
app.post("/suppliers", requireAuthentication, requireAdministrator, async (req, res) => {
  const input = parseSupplierInput(req.body);

  const newId = await db.transaction(async (tx) => {
    const row = await toSupplierRow(tx, input);
    const [created] = await tx.insert(suppliers).values({ ...row, isActive: row.isActive ?? true }).returning({ id: suppliers.id });
    if (!created) throw new Error("Supplier insert returned no row");
    return created.id;
  });

  const [supplier] = await selectSuppliers(eq(suppliers.id, newId));
  res.status(201).json(supplier);
});

// Omitting isActive keeps its current value.
app.put("/suppliers/:id", requireAuthentication, requireAdministrator, async (req, res) => {
  const id = getSupplierIdParam(req);
  const input = parseSupplierInput(req.body);

  const found = await db.transaction(async (tx) => {
    const updated = await tx.update(suppliers).set(await toSupplierRow(tx, input)).where(eq(suppliers.id, id)).returning({ id: suppliers.id });
    return updated.length > 0;
  });
  if (!found) throw new HttpError(404, "Supplier not found");

  const [supplier] = await selectSuppliers(eq(suppliers.id, id));
  res.status(200).json(supplier);
});

// Hard delete: operating hours reference the supplier, so they are removed first.
app.delete("/suppliers/:id", requireAuthentication, requireAdministrator, async (req, res) => {
  const id = getSupplierIdParam(req);
  const found = await db.transaction(async (tx) => {
    await tx.delete(operatingHours).where(eq(operatingHours.supplierId, id));
    const deleted = await tx.delete(suppliers).where(eq(suppliers.id, id)).returning({ id: suppliers.id });
    return deleted.length > 0;
  });

  if (!found) throw new HttpError(404, "Supplier not found");
  res.status(204).end();
});

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  if (error instanceof SyntaxError && "status" in error && error.status === 400) {
    res.status(400).json({ error: "Request body contains invalid JSON" });
    return;
  }

  console.error("[supplier-service] Request failed", error);
  res.status(500).json({ error: "Internal server error" });
};

app.use(errorHandler);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(port, "0.0.0.0", (error) => {
    if (error) throw error;
    console.log(`Supplier service listening on http://localhost:${port}`);
  });
}
