<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
Scope: Record this session's AI assistance. 
Author review: Checked for correctness. -->
# AI usage log (Supplier Service)

## 2026-09-28: Nuxt frontend service

- Tool: ChatGPT / Codex (GPT-6). Mode: Implementation, configuration, and verification.
- Exact prompt: `build a frontend service (nuxtjs). edit the compose file, add a dependency on the supplier service. the frontend will call supplier-service on the same network. do ensure the segregation of the code on the frontend as well (separated by the services you see in the folder). you may shift the port numbers around (since supplier service is on 3000 already) to avoid clashing. the service will have its own dependencies as well, do manage that`
- Key response: Added an independent Nuxt frontend on host port 3001, with a
  service-specific supplier directory, filters, and request states. A Nuxt server
  endpoint forwards requests to supplier-service:3000 over Compose's default
  network using private runtime configuration (the Compose dependency was later removed). Added service folders for supplier,
  user, order, and credit frontend code, an independent dependency manifest and
  lockfile, a multi-stage Dockerfile,.
- Affected files: Authored files in `frontend-service/`, `compose.yaml`,
  `.env.example`, `README.md`, and this log. `frontend-service/package-lock.json`
  is npm-generated. The six files under `frontend-service/public/images/suppliers/`
  are copies of the user-supplied repository assets, not AI-generated images.
- Follow-up tool: Claude Code (Claude Opus 5.5). Prompt: continue Codex's
  verification. Changed the shared supplier type imports in four frontend files to
  Nuxt's `#shared` alias because the relative paths failed `nuxt typecheck`.
  At the user's request, removed the frontend's Compose `depends_on` and the
  supplier-service health check so the frontend can be cherry-picked on its own.
  Verified the build, typecheck, Compose startup, API forwarding, and desktop and
  phone layouts.
- Author review: Pending review of these frontend changes.

## 2026-09-28: Supplier response joins

- Tool: ChatGPT / Codex (GPT-6). Mode: Implementation, tests, and documentation.
- Exact prompt: `perform the join to join building names and type, and reflect that in get suppliers/. supplier type id and building id should be omitted from the response`
- Key response: GET /suppliers now returns the joined `type` and `buildingName`,
  excluding `supplierTypeId` and `buildingId`. A left join preserves suppliers
  without a building and returns `buildingName: null`. Filtering and open-first
  ordering remain in place.
- Affected files: `supplier-service/src/index.ts`,
  `supplier-service/test/suppliers.test.mjs`, `supplier-service/README.md`, and
  this log. The project README links this consolidated disclosure.
- Author review: Response changes verified.
- Verification: Typecheck and build passed. All seven integration tests passed,
  including correct names from two different buildings, null building handling,
  omission of both foreign-key ID fields, filtering, and opening-time behavior.

## 2026-09-28: GET suppliers happy path

- Tool: ChatGPT / Codex (GPT-6). Mode: Implementation, tests, and documentation.
- Exact prompt: `implement the GET suppliers route. optional query parameters for name (fuzzy search) and type. implement for happy path first (200). all suppliers currently open should appear before suppliers currently closed.`
- Clarification: Asked whether fuzzy search meant case-insensitive partial
  matching or typo tolerance. Exact answer: `Case-insensitive partial match`.
- Clarification: Asked to return a JSON array of supplier fields plus `isOpen`,
  use Singapore time, include inactive suppliers as closed, and filter `type` by
  its name (e.g. Food). Exact answer: `Yes, use those defaults`.
- Key response: Added GET /suppliers with optional AND-combined name and exact
  type-name filters. Open suppliers sort first, followed by name and UUID.
  Opening status handles daily periods and previous-day overnight carryover in
  Asia/Singapore, including Saturday-to-Sunday rollover. Inactive suppliers are
  closed. Empty results return HTTP 200 with an empty array.
- Affected files: `supplier-service/src/index.ts`,
  `supplier-service/src/db/opening-hours.ts`,
  `supplier-service/test/suppliers.test.mjs`, `supplier-service/package.json`,
  `supplier-service/README.md`, `README.md`, and this log.
- Verification: Typecheck and build passed. Six integration tests passed against
  a uniquely named disposable PostgreSQL database, including HTTP filtering,
  open-first ordering, literal wildcard input, and 11 clock/period boundary cases.
  The test database was removed afterward.
- Runtime verification: Rebuilt and restarted the Compose supplier-service and
  confirmed HTTP 200 responses for unfiltered, name-only, type-only, combined,
  and no-match requests through host port 3000.
- Author review: Review done for these route changes.

## 2026-09-28: pgAdmin connection diagnosis

- Tool: ChatGPT / Codex (GPT-6). Mode: Debugging and configuration correction.
- Exact prompt: `yeah, i thought so too, but it says password is wrong`
- Key response: Windows PostgreSQL owns host port 5432. The Compose database
  had no published port. Confirmed supplier/supplier authentication against the
  container's network address with SCRAM authentication, then published the
  container on 127.0.0.1:5433 for desktop pgAdmin.
- Affected files: `compose.yaml`, `.env.example`, `supplier-service/README.md`,
  `README.md`, and this log.
- Author review: Verified connection changes are the correct fix.
- Verification: Applied the mapping with `docker compose up -d supplier-db`,
  preserving the existing volume. A Windows-host TCP connection to
  `127.0.0.1:5433` authenticated as `supplier`, connected to `suppliers`, and
  confirmed all four public tables remain present.

## 2026-09-28: COM2 seed naming

- Tool: ChatGPT / Codex (GPT-6). Mode: Seed data correction and documentation.
- Exact prompt: `standardise com2 and com 2 to COM2`
- Key response: Standardized the two building references to `COM2` and the
  printer name to `Printer @ COM2` in the seed snapshot. The seed now has 16
  distinct building names. Fixed supplier UUIDs and the source CSV are preserved.
- Affected files: `supplier-service/src/db/seed-data.ts`,
  `supplier-service/README.md`, and this log.
- Author review: Done

## 2026-09-28: Supplier seed from CSV

- Tool: ChatGPT / Codex (GPT-6).
- Mode: CSV inspection, seed implementation, documentation, and verification.
- Exact prompt: `next, i want you to take a look at ../data/csv. this file contains some seed data for the supplier service. write a seed file (compatible with the current schema) from that csv data`
- Source located at `data/csv/supplier-seed-data.csv` in this repository.
- Clarification question: The CSV has opening/closing times but no weekdays or
  active status. How should the seed fill those required details?
- Exact answer: `All suppliers active; hours every day (Sunday–Saturday)`
- Key response: Created a typed snapshot of all 21 CSV suppliers and a Drizzle
  seed script. It reuses the four type names and 17 exact building names, creates
  seven daily periods per new supplier, and uses fixed supplier UUIDs to skip
  existing seed suppliers on reruns. Writes are transactional, with a dry-run
  option that rolls back all changes.
- Conversion: Decoded Windows-1252 source data, trimmed surrounding whitespace,
  retained source names and image URLs, converted blank optional fields to null
  and HHMMhrs to database times. Coordinates retain their source precision until
  PostgreSQL rounds them to six decimal places. The source CSV is unchanged.
- Affected files: `supplier-service/src/db/seed-data.ts`,
  `supplier-service/src/db/seed.ts`, `supplier-service/package.json`,
  `supplier-service/README.md`, `README.md`, and this log.
- Author review: Seed files work as expected.
  apply to earlier work only.
- Verification: Typecheck, build, and Docker tooling build passed. Compared every
  converted field in all 21 records with the CSV, including quoted commas and
  Windows-1252 apostrophes. The CLI dry run inserted 21 suppliers and 147 periods,
  then rolled back. Database verification checked all mappings and exact decimal
  rounding, lookup reuse, and seven daily periods per supplier. A second seed
  inserted nothing and preserved edited suppliers, hours, and timestamps.
  Verified all database contents were unchanged after rollback; no seed data was
  committed during this task.

## 2026-09-28: Drizzle setup

- Tool: ChatGPT / Codex (GPT-6).
- Mode: Boilerplate generation, documentation, and verification.
- Exact prompt: `take a look at agents.md first. next, set up drizzle orm`
- Key response: Added Drizzle ORM with the node-postgres driver, a shared
  connection pool using `DATABASE_URL`, Drizzle Kit configuration and commands,
  an empty schema scaffold, and opt-in Docker tooling for the existing database.
  The existing schema notes leave column types and defaults unspecified;
  the student retains responsibility for finalizing and implementing that design.
- Affected files: `supplier-service/package.json`, npm-generated
  `supplier-service/package-lock.json`, `supplier-service/src/db/index.ts`,
  `supplier-service/src/db/schema.ts`, `supplier-service/src/db/check.ts`,
  `supplier-service/drizzle.config.ts`, `supplier-service/drizzle/.gitkeep`,
  Drizzle-generated `supplier-service/drizzle/meta/_journal.json`,
  `supplier-service/Dockerfile`, `compose.yaml`, `.env.example`,
  `supplier-service/README.md`, `README.md`, and this log.
- Attribution: Authored text files have header comments. `package.json` uses
  a `//` metadata field because JSON does not support comments. The generated
  lockfile, migration journal, and empty directory marker are attributed here.
- Verification: TypeScript typecheck and build passed; production and tooling
  Docker builds passed; read-only Drizzle connection checks passed in both
  images; migration generation passed on Windows and in Docker with zero tables;
  the empty migration journal applied successfully using Docker tooling.
  No application tables were created. Drizzle initialized its migration metadata.
- Dependency audit: Production dependencies reported zero vulnerabilities.
  Drizzle Kit's development dependency chain reported four moderate findings
  associated with esbuild; npm's suggested fix requires a breaking downgrade.
- Author review: Check for correctness.

## 2026-09-28: Node globals in the Drizzle configuration

- Tool: ChatGPT / Codex (GPT-6).
- Mode: Debugging, configuration fix, and documentation.
- Exact prompt: ``Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig -- tsconfig looks correct already, and ive restarted typescript server``
- Clarification: The user confirmed the affected file is
  `supplier-service/drizzle.config.ts`.
- Key response: Node types were installed and source typechecking passed, but
  `drizzle.config.ts` was excluded by `include: ["src/**/*.ts"]`. Included it in
  the editor/typecheck project and added a build config that preserves
  source-only compilation and the `dist/index.js` entry point.
- Affected files: `supplier-service/tsconfig.json`,
  `supplier-service/tsconfig.build.json`, `supplier-service/package.json`,
  `supplier-service/Dockerfile`, `supplier-service/README.md`, `README.md`,
  and this log.
- Verification: Typecheck now includes `drizzle.config.ts` and passes. The build
  passes and still emits `dist/index.js`. Both Docker targets build successfully.
- Author review: Check for correctness.

## 2026-09-28: Supplier schema implementation and migration

- Tool: ChatGPT / Codex (GPT-6).
- Mode: Implementation of the student-defined schema, migration generation,
  migration execution, documentation, and verification.
- Exact prompt: `refer to docs/database_schemas.md. edit the schema file, generate migrations, and migrate`
- Clarification question: The notes specify UUIDs and timestamp columns but not
  their defaults or timezone. Since AGENTS.md reserves schema decisions for you,
  which should I implement? (updated_at will use your specified $onUpdate callback.)
- Exact answer: `Generated UUIDs; timestamptz with defaultNow()`
- Key response: Implemented `types`, `buildings`, `suppliers`, and
  `operating_hours`, including the documented nullability, unique names, foreign
  keys, coordinate and weekday checks, and three-column operating-hours primary
  key. Added the user-confirmed UUID and timestamp defaults and the documented
  Drizzle `$onUpdate` callback. Generated `0000_supplier_schema.sql`.
- Affected files: `supplier-service/src/db/schema.ts`,
  `supplier-service/drizzle/0000_supplier_schema.sql`, Drizzle-generated
  `supplier-service/drizzle/meta/0000_snapshot.json` and `meta/_journal.json`,
  `supplier-service/docs/database_schemas.md`, `supplier-service/README.md`,
  `README.md`, and this log. Generated JSON metadata is attributed here because
  JSON does not support header comments.
- Execution: Applied `0000_supplier_schema.sql` to the Compose `supplier-db`
  database `suppliers`. Its recorded migration hash matches the SQL file.
- Verification: Typecheck and build passed. A Drizzle transaction verified
  generated UUIDs, timestamp defaults, nullable fields, inclusive coordinate
  endpoints, overnight and multiple daily opening periods, and `$onUpdate` on
  all four tables. Thirteen invalid-input cases verified range, uniqueness,
  foreign-key, primary-key, and not-null constraints. All test records rolled
  back; all four tables contain zero records. A second generation reported no
  schema changes, and rerunning migration left one migration history entry.
- Author review: The latest schema, migration, and documentation changes await
  student review; prior review statements apply to earlier work only.
