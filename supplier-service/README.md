<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
Scope: Drizzle setup and usage documentation. Prior content reviewed;
seed, local database access, and route documentation changes await review.
Claude Code (Opus 5.5), 2026-09-29: authentication, PUT, and DELETE documentation. Author review: Pending. -->
# Supplier Service

Run commands from `supplier-service/`:

```sh
npm install
npm run dev
```

`npm run dev` compiles TypeScript and starts the Express server on port 3000.
`GET /` returns a JSON status message. Restart the command after code changes.
Set `DATABASE_URL` before starting the server (see the host database instructions
below); `GET /suppliers` queries PostgreSQL.

To compile and run the built server:

```sh
npm run build
npm start
```

Run `npm run typecheck` to check both `src/` and `drizzle.config.ts` without
generating output. `tsconfig.json` owns both in the editor, including Node globals
such as `process`. `npm run build` uses `tsconfig.build.json` to compile only
`src/`, preserving the `dist/index.js` entry point.

## Authentication

Every `/suppliers` route requires an `Authorization: Bearer <token>` header carrying
a user-service access token. supplier-service forwards the header to user-service
`GET /me` (at `USER_SERVICE_BASE_URL`, default `http://127.0.0.1:3333`) to resolve
the caller and their role.

| Situation | Response |
| --- | --- |
| Missing, malformed, expired, or rejected token | 401 `{ "error": "A valid bearer token is required" }` |
| Non-admin calling `PUT` or `DELETE` | 403 `{ "error": "Administrator access is required" }` |
| user-service unreachable or failing | 502 |

Errors are JSON objects with an `error` message.

## GET /suppliers

Returns HTTP 200 with a JSON array of supplier records in camelCase, plus a boolean
`isOpen`. The response includes joined `type` and `buildingName` values and omits
`supplierTypeId` and `buildingId`. Suppliers without a building remain in the
results with `buildingName: null`. The supplier's own `id` is retained.
No matches returns `[]`.

| Query parameter | Behavior |
| --- | --- |
| `name` | Optional case-insensitive partial name match. `%`, `_`, and backslash are literal characters. |
| `type` | Optional exact, case-sensitive type name, such as `Food` or `Food/Coffee`. |

Both filters combine with AND. Surrounding whitespace is trimmed; blank values
act as omitted filters. For example:

```sh
curl -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3000/suppliers"
curl -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3000/suppliers?name=cafe&type=Food%2FCoffee"
```

Open suppliers come first, followed by closed suppliers. Each group is sorted
by name and then UUID for stable ties. Students only receive active suppliers;
administrators also receive inactive suppliers, with `isOpen: false`. Opening status uses Singapore time (`Asia/Singapore`), includes
the opening instant, and excludes the closing instant. It checks multiple daily
periods and overnight periods that started on the previous day. A supplier with
no matching period is closed. Multiple matching periods return the supplier once.

## PUT /suppliers/:id (administrators)

Versioned update. In one transaction, the current row is marked `isActive: false`,
and a new active row (with a new `id`) is inserted with the edited values and a copy
of the old row's operating hours. Returns 200 with the new supplier, in the same
shape as a `GET /suppliers` item.

The JSON body must contain all of these fields:

| Field | Rules |
| --- | --- |
| `name` | Required, at most 256 characters |
| `type` | Required; an existing type name |
| `buildingName` | `null` or an existing building name |
| `floor`, `locationDescription` | `null` or at most 256 characters |
| `latitude`, `longitude` | Number or numeric string, within ±90 and ±180 |
| `imageUrl` | `null` or an `http`/`https` URL |

Strings are trimmed; blank optional strings are stored as `null`. Invalid bodies
return 400. Unknown or malformed ids return 404. Inactive suppliers (including
superseded versions) return 409.

## DELETE /suppliers/:id (administrators)

Soft delete: marks the supplier `isActive: false` and returns 204. The row and its
hours are kept. Unknown or malformed ids return 404; an already inactive supplier
returns 409.

`POST /suppliers` is intentionally not implemented yet.

### Route tests

From `supplier-service/`, using PowerShell and the local Compose database:

```powershell
$env:TEST_DATABASE_URL = 'postgres://supplier:supplier@127.0.0.1:5433/suppliers'
npm test
```

The PostgreSQL role must have permission to create databases. Tests create a
uniquely named disposable database, apply migrations, check HTTP responses and
opening-time boundaries, then drop that test database. Application data is not
used for test fixtures. A stub user-service started by the tests maps fixed tokens
to a student and an administrator.

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
