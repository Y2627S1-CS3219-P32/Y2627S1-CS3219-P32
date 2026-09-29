/**AI Assistance Disclosure:
Tool: ChatGPT(model: GPT6), date: 2026-09-28
Scope: Express server and GET /suppliers happy-path implementation.
Author review: Prior boilerplate reviewed; route changes await review.
Tool: Claude Code (model: Opus 5.5), date: 2026-09-29
Scope: Authentication on GET /suppliers, role-based visibility of inactive suppliers,
administrator-only PUT (versioned) and DELETE (soft) /suppliers/:id, and error handling.
Author review: Done. **/

import "dotenv/config";
import { pathToFileURL } from "node:url";
import { and, asc, desc, eq, getTableColumns, ilike, sql, type SQL } from "drizzle-orm";
import express, { type ErrorRequestHandler, type Request } from "express";
import { getAuthenticatedUser, requireAdministrator, requireAuthentication } from "./auth.js";
import { db } from "./db/index.js";
import { openingHoursMatch } from "./db/opening-hours.js";
import { buildings, operatingHours, suppliers, types } from "./db/schema.js";
import { HttpError } from "./errors.js";
import { parseSupplierInput } from "./supplier-input.js";

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

// Versioned update: the current row is marked inactive and replaced by a new
// active row (with a new id) that carries the edited values and copied hours.
app.put("/suppliers/:id", requireAuthentication, requireAdministrator, async (req, res) => {
  const id = getSupplierIdParam(req);
  const input = parseSupplierInput(req.body);

  const newId = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ isActive: suppliers.isActive })
      .from(suppliers)
      .where(eq(suppliers.id, id))
      .for("update");
    if (!current) throw new HttpError(404, "Supplier not found");
    if (!current.isActive) throw new HttpError(409, "Only active suppliers can be updated");

    const [type] = await tx.select({ id: types.id }).from(types).where(eq(types.name, input.type));
    if (!type) throw new HttpError(400, `Unknown supplier type: ${input.type}`);

    let buildingId: string | null = null;
    if (input.buildingName) {
      const [building] = await tx.select({ id: buildings.id }).from(buildings).where(eq(buildings.name, input.buildingName));
      if (!building) throw new HttpError(400, `Unknown building: ${input.buildingName}`);
      buildingId = building.id;
    }

    await tx.update(suppliers).set({ isActive: false }).where(eq(suppliers.id, id));
    const [created] = await tx.insert(suppliers).values({
      name: input.name,
      supplierTypeId: type.id,
      buildingId,
      floor: input.floor,
      locationDescription: input.locationDescription,
      latitude: input.latitude,
      longitude: input.longitude,
      imageUrl: input.imageUrl,
      isActive: true,
    }).returning({ id: suppliers.id });
    if (!created) throw new Error("Supplier insert returned no row");

    const hours = await tx
      .select({ day: operatingHours.day, openingHrs: operatingHours.openingHrs, closingHrs: operatingHours.closingHrs })
      .from(operatingHours)
      .where(eq(operatingHours.supplierId, id));
    if (hours.length) {
      await tx.insert(operatingHours).values(hours.map(hour => ({ ...hour, supplierId: created.id })));
    }
    return created.id;
  });

  const [supplier] = await selectSuppliers(eq(suppliers.id, newId));
  res.status(200).json(supplier);
});

// Soft delete: the row is kept and marked inactive.
app.delete("/suppliers/:id", requireAuthentication, requireAdministrator, async (req, res) => {
  const id = getSupplierIdParam(req);
  const updated = await db
    .update(suppliers)
    .set({ isActive: false })
    .where(and(eq(suppliers.id, id), eq(suppliers.isActive, true)))
    .returning({ id: suppliers.id });

  if (!updated.length) {
    const [existing] = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, id));
    throw existing
      ? new HttpError(409, "Supplier is already inactive")
      : new HttpError(404, "Supplier not found");
  }
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
