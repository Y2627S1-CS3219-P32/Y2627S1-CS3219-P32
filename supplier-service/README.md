<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
Scope: Drizzle setup and usage documentation. Reviewed; -->
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

Set `DATABASE_URL` in `supplier-service/.env` to a PostgreSQL instance reachable
from your host. The repository `.env.example` documents its format. The existing
Compose database does not publish a host port, and `supplier-db` resolves only
inside the Compose network; use the tooling container for that database.

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

# AI Disclosure

AI Use Summary

Tools: GPT6

Prohibited phrases avoided: requirements elicitation; architecture/design decisions

Used for: Boilerplate generation, Drizzle configuration, connection verification,
and documentation. See the consolidated [usage log](../AI_USAGE_LOG.md).

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
