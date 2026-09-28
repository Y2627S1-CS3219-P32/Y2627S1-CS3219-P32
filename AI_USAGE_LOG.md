<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
Scope: Record this session's AI assistance. 
Author review: Checked for correctness. -->
# AI usage log (Supplier Service)

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
