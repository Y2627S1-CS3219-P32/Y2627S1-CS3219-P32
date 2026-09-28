<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
Scope: Drizzle setup and usage documentation. Prior content reviewed;
seed and local database access documentation changes await review. -->
# Supplier Service

Run commands from `supplier-service/`:

```sh
npm install
npm run dev
```

`npm run dev` compiles TypeScript and starts the Express server on port 3000.
`GET /` returns a JSON status message. Restart the command after code changes.

To compile and run the built server:

```sh
npm run build
npm start
```

Run `npm run typecheck` to check both `src/` and `drizzle.config.ts` without
generating output. `tsconfig.json` owns both in the editor, including Node globals
such as `process`. `npm run build` uses `tsconfig.build.json` to compile only
`src/`, preserving the `dist/index.js` entry point.

## Docker

From the repository root, build and start the service with its database:

```sh
docker compose up -d --build supplier-service
```

The service is available at `http://localhost:3000`. Running this command again
rebuilds the image and replaces the existing service container.

To run the service locally with npm instead, first free port 3000:

```sh
docker compose stop supplier-service
```

The Docker build compiles TypeScript in a build stage. The runtime image contains
the compiled code and production dependencies and runs as the non-root `node` user.

## Drizzle ORM

The PostgreSQL client is exported as `db` from `src/db/index.ts`, with its
connection pool exported as `pool`. It reads `DATABASE_URL` from the environment
or from `supplier-service/.env` when commands run in this directory. Import it
from service code with `import { db } from "./db/index.js"` (adjust the relative
path as needed). Standalone scripts should call `await pool.end()` when done.

`src/db/schema.ts` implements the student-defined schema in
[`docs/database_schemas.md`](docs/database_schemas.md): `types`, `buildings`,
`suppliers`, and `operating_hours`. The initial migration is
`drizzle/0000_supplier_schema.sql`. UUID primary keys are generated automatically;
all tables have `created_at` and `updated_at` timestamps with timezone, defaulting
to the current time. Drizzle updates `updated_at` through `$onUpdate` when an
update does not explicitly set that column. This callback runs in Drizzle;
direct SQL updates must set `updated_at` themselves.

Coordinate and weekday ranges are enforced by database checks. Operating hours
use the composite key `(supplier_id, day, opening_hrs)`, allowing multiple periods
per day and overnight periods. Overlap validation belongs in the service layer;
an absent day means closed. PostgreSQL numeric coordinates are returned as strings
by the default Drizzle mapping.

### Use the existing Docker database

Run these commands from the repository root:

```sh
docker compose --profile tools build supplier-db-tools
docker compose --profile tools run --rm supplier-db-tools npm run db:check
```

The opt-in tooling container includes development dependencies and connects to
`supplier-db` through the existing Compose network. Its default command is also
`db:check`, a read-only `SELECT 1` through Drizzle. Source files and the `drizzle/`
directory are mounted, so generated migrations persist in the repository.
Rebuild the tooling image after dependency changes.

After changing table definitions, generate SQL, review it, and apply it:

```sh
docker compose --profile tools run --rm supplier-db-tools npm run db:generate
docker compose --profile tools run --rm supplier-db-tools npm run db:migrate
```

Commit the generated SQL and snapshot files in `drizzle/`. Migrations are an
explicit command; starting the Express server does not apply them.

### Run tools from the host

The Compose database is published at `127.0.0.1:5433`. Set this in
`supplier-service/.env` for host-side commands:

```dotenv
DATABASE_URL=postgres://supplier:supplier@127.0.0.1:5433/suppliers
```

In desktop pgAdmin, register a server with host `127.0.0.1`, port `5433`,
maintenance database `suppliers`, username `supplier`, and password `supplier`.
Port `5432` on this Windows host belongs to a separate PostgreSQL instance.
Containers continue to use `supplier-db:5432` on the Compose network.

From `supplier-service/`:

```sh
npm run db:check
npm run db:generate
npm run db:migrate
npm run db:studio
```

`db:generate` works offline without `DATABASE_URL`; the other database commands
need a reachable database. Drizzle Studio is intended for this host workflow.

Reference: [Drizzle PostgreSQL setup](https://orm.drizzle.team/docs/get-started/postgresql-new).

## Seed data

`src/db/seed-data.ts` is a typed snapshot of
[`data/csv/supplier-seed-data.csv`](../data/csv/supplier-seed-data.csv).
`src/db/seed.ts` loads it through Drizzle. On an empty migrated database it inserts
21 active suppliers, four types, 16 building names, and 147 operating-hour rows.
As confirmed for this seed, each supplier's CSV hours apply Sunday through Saturday.

From the repository root, after applying migrations:

```sh
docker compose --profile tools build supplier-db-tools
docker compose --profile tools run --rm supplier-db-tools npm run db:seed -- --dry-run
docker compose --profile tools run --rm supplier-db-tools npm run db:seed
```

With a host-accessible `DATABASE_URL`, run `npm run db:seed` from
`supplier-service/`; add `-- --dry-run` to verify and roll back every write.
Normal execution commits all records in one transaction, or rolls everything
back on failure.

The seed reuses types and buildings by exact name. Fixed supplier UUIDs make
reruns skip existing seed suppliers and their hours, preserving subsequent edits.
It does not delete records or overwrite existing data. Keep the UUIDs stable
when editing the snapshot; changes to existing seed records are not applied by
rerunning this insert-only seed.

CSV conversion details:

- The source uses Windows-1252; its apostrophes are preserved in UTF-8 seed data.
- Whitespace around values is trimmed, and blank optional fields become `NULL`.
- Coordinates keep their source precision in the snapshot; PostgreSQL rounds
  them to the schema's six decimal places on insertion.
- `HHMMhrs` becomes `HH:MM:00`. Overnight hours such as `11:00` to `02:00` and
  the source's `00:00` to `23:59` periods are preserved.
- `Com 2` and `Com2` are standardized to `COM2`, including the printer's name.
  Straight/curly apostrophes in Prince George's Park remain distinct. Image URLs
  and `Food/Coffee` remain as given.

The seed snapshot is committed with the service; running it does not reread the
CSV. No database schema changes or new runtime dependencies are required.

# AI Disclosure

AI Use Summary

Tools: GPT6

Prohibited phrases avoided: requirements elicitation; architecture/design decisions

Used for: Boilerplate generation, Drizzle configuration, connection verification,
and documentation. See the consolidated [usage log](../AI_USAGE_LOG.md).

The CSV-derived seed implementation and its validation are also recorded there.

Logs:

- Source & mode: GPT6, Generation of boilerplate
- Prompts: in supplier-service/ ive set up some parts of the project. write some boilerplate express code to listen on 3000, check my dockerfile and fill up the instructions for running in the README
- Prompt (2026-09-28): take a look at agents.md first. next, set up drizzle orm
- Key response: Added Drizzle setup boilerplate and an empty schema scaffold;
  table design remains with the student. Human checked for correctness
- Prompt (2026-09-28): refer to docs/database_schemas.md. edit the schema file, generate migrations, and migrate
- Key response: Implemented the documented four-table schema with the user's
  confirmed defaults and generated its initial migration. See the usage log for
  migration and validation results. These changes await student review.
