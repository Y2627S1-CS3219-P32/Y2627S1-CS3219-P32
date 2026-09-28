/**
 * AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
 * Scope: Repeatable supplier seed with transactional dry-run support.
 * Author review: Done.
 */
import { pathToFileURL } from "node:url";
import { inArray } from "drizzle-orm";
import { db, pool } from "./index.js";
import { buildings, operatingHours, suppliers, types } from "./schema.js";
import { supplierSeedData } from "./seed-data.js";

type SeedSummary = {
  suppliersInserted: number;
  suppliersSkipped: number;
  operatingHoursInserted: number;
};

// Pass a transaction so suppliers and their hours are inserted atomically.
export async function seedSuppliers(tx: Pick<typeof db, "insert" | "select">): Promise<SeedSummary> {
  const typeNames = [...new Set(supplierSeedData.map((row) => row.typeName))];
  const buildingNames = [...new Set(supplierSeedData.map((row) => row.buildingName))];

  await tx.insert(types).values(typeNames.map((name) => ({ name })))
    .onConflictDoNothing({ target: types.name });
  await tx.insert(buildings).values(buildingNames.map((name) => ({ name })))
    .onConflictDoNothing({ target: buildings.name });

  const typeIds = new Map(
    (await tx.select().from(types).where(inArray(types.name, typeNames)))
      .map((row) => [row.name, row.id]),
  );
  const buildingIds = new Map(
    (await tx.select().from(buildings).where(inArray(buildings.name, buildingNames)))
      .map((row) => [row.name, row.id]),
  );

  const summary: SeedSummary = {
    suppliersInserted: 0,
    suppliersSkipped: 0,
    operatingHoursInserted: 0,
  };

  for (const row of supplierSeedData) {
    const supplierTypeId = typeIds.get(row.typeName);
    const buildingId = buildingIds.get(row.buildingName);
    if (!supplierTypeId || !buildingId) {
      throw new Error(`Missing type or building for seed supplier: ${row.name}`);
    }

    const [inserted] = await tx.insert(suppliers).values({
      id: row.id,
      name: row.name,
      supplierTypeId,
      buildingId,
      floor: row.floor,
      locationDescription: row.locationDescription,
      latitude: row.latitude,
      longitude: row.longitude,
      isActive: true,
      imageUrl: row.imageUrl,
    }).onConflictDoNothing({ target: suppliers.id }).returning({ id: suppliers.id });

    // Existing seed suppliers (including user edits to them) stay untouched.
    if (!inserted) {
      summary.suppliersSkipped++;
      continue;
    }

    await tx.insert(operatingHours).values(
      Array.from({ length: 7 }, (_, day) => ({
        supplierId: inserted.id,
        day,
        openingHrs: row.openingHrs,
        closingHrs: row.closingHrs,
      })),
    );
    summary.suppliersInserted++;
    summary.operatingHoursInserted += 7;
  }

  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--dry-run")) {
    throw new Error("Usage: npm run db:seed -- [--dry-run]");
  }
  const dryRun = args.includes("--dry-run");
  const rollback = new Error("Seed dry run rollback");
  let summary: SeedSummary | undefined;

  try {
    await db.transaction(async (tx) => {
      summary = await seedSuppliers(tx);
      if (dryRun) throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }

  console.log(dryRun ? "Seed dry run succeeded; all changes rolled back." : "Seed committed.");
  console.log(summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } finally {
    await pool.end();
  }
}
