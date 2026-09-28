/**AI Assistance Disclosure:
Tool: ChatGPT(model: GPT6), date: 2026-09-28
Scope: Express server and GET /suppliers happy-path implementation.
Author review: Prior boilerplate reviewed; route changes await review. **/

import "dotenv/config";
import { pathToFileURL } from "node:url";
import { and, asc, desc, eq, getTableColumns, ilike, sql } from "drizzle-orm";
import express from "express";
import { db } from "./db/index.js";
import { openingHoursMatch } from "./db/opening-hours.js";
import { buildings, suppliers, types } from "./db/schema.js";

export const app = express();
const port = 3000;

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ message: "Supplier service is running" });
});

app.get("/suppliers", async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name.trim() : undefined;
  const type = typeof req.query.type === "string" ? req.query.type.trim() : undefined;
  // Treat LIKE metacharacters as literal search text.
  const namePattern = name ? `%${name.replace(/[\\%_]/g, "\\$&")}%` : undefined;
  const isOpen = sql<boolean>`${suppliers.isActive} and ${openingHoursMatch(new Date(), "Asia/Singapore")}`;
  const { supplierTypeId, buildingId, ...supplierColumns } = getTableColumns(suppliers);

  const results = await db
    .select({ ...supplierColumns, type: types.name, buildingName: buildings.name, isOpen })
    .from(suppliers)
    .innerJoin(types, eq(supplierTypeId, types.id))
    .leftJoin(buildings, eq(buildingId, buildings.id))
    .where(and(
      namePattern ? ilike(suppliers.name, namePattern) : undefined,
      type ? eq(types.name, type) : undefined,
    ))
    .orderBy(desc(isOpen), asc(suppliers.name), asc(suppliers.id));

  res.status(200).json(results);
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(port, "0.0.0.0", (error) => {
    if (error) throw error;
    console.log(`Supplier service listening on http://localhost:${port}`);
  });
}
