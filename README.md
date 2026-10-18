<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
Scope: Consolidated AI disclosure. Author review: Done. -->
# CS3219 — Software Design and Architecture (AY2627 Sem 1)

## Friend on Campus (FoC)

**Friend on Campus (FoC)** is a peer-to-peer campus errand platform where
students can request items to be collected from stores or facilities on
campus, and other students can fulfil (and deliver) those requests. The
platform runs on a closed credit economy — credits cannot be bought,
withdrawn, or exchanged for money, and only circulate within the platform.

---

## Team Members

| Name | Role |
| ----- | ----- |
| Your Name | Your ownership |
| Your Name | Your ownership |
| Your Name | Your ownership |
| Your Name | Your ownership |
| Your Name | Your ownership |

---

## Repository Structure

This repository follows a **one-service-per-folder** structure: each
microservice (`user-service/`, `supplier-service/`, `order-service/`,
`credit-service/`) lives in its own top-level folder.

```text
.
├── user-service/
├── supplier-service/
├── order-service/
├── credit-service/
├── <n2h-service>/
└── README.md
```

- Any **nice-to-have (N2H)** feature that warrants its own service should
  be added as an **additional folder** at the same level, following the
  same per-service structure.
- Files for agentic coding tools (e.g. agent configs, prompts, skills)
  may be added as needed, but must still **respect the
  one-service-per-folder skeleton** for core implementation.

## Configure the root environment

Before starting the services, copy [`.env.example`](.env.example) to `.env` in
the repository root and replace `JWT_SECRET` with a long, randomly generated
secret. `BOOTSTRAP_SECRET` is optional.

---

## Run the frontend

```sh
docker compose up -d --build frontend-service
```

Open **http://127.0.0.1:3001**. The independent Nuxt app lives in
[`frontend-service/`](frontend-service/README.md), with frontend code grouped by
supplier, user, order, and credit service. It starts independently of the
supplier service; run `docker compose up -d supplier-service` for supplier data,
which Nuxt fetches over the Compose network. The supplier API remains on host port 3000.

## Develop with hot reloading

```sh
docker compose -f compose.yaml -f compose.dev.yaml up --watch
```

[`compose.dev.yaml`](compose.dev.yaml) runs the supplier and user services with
`tsx watch`, the user event worker with `tsx watch`, and the frontend with `nuxt dev`.
Compose also starts a local Pub/Sub emulator and PostgreSQL projection worker.
User-service mutations are acknowledged when Pub/Sub accepts them; PostgreSQL
updates asynchronously, so immediate reads or logins can briefly lag. Compose
syncs source edits into the containers, which restart (backends) or hot-swap
modules (frontend) on change.
Editing a `package.json` rebuilds that service's image. Outside Docker, run
`npm run dev` in any of these service folders.

## Deploy to Google Cloud (Cloud Run)

<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-09-30.
Scope: Manual Cloud Build and Cloud Run deployment instructions. Author review: Done. -->

Images are built by [`cloudbuild.yaml`](cloudbuild.yaml) and deployed by
[`deploy.sh`](deploy.sh). Run from the repository root with the target project selected
(`gcloud config set project <id>`):

```sh
gcloud builds submit --config cloudbuild.yaml --region asia-southeast1  # build and push images
./deploy.sh setup   # one-time: Cloud SQL, Pub/Sub, databases, secrets, IAM, networking
./deploy.sh         # run migrations, deploy services and authenticated Pub/Sub worker
./deploy.sh seed    # load supplier seed data (safe to repeat)
```

### Automatic deployment (GitHub Actions)

<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
Scope: GitHub Actions deployment instructions. Author review: Pending. -->

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds the images and runs
`./deploy.sh` on every push to `main` (it can also be run manually from the Actions tab, with an
option to seed). It signs in through Workload Identity Federation, so no service account key is
stored in GitHub. One-time setup, after `./deploy.sh setup`:

```sh
./deploy.sh github  # deployer service account, identity pool restricted to this repo's main branch
```

Then add the three printed values (`GCP_PROJECT_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER`,
`GCP_SERVICE_ACCOUNT`) as repository variables under Settings > Secrets and variables > Actions.

The user service publishes state-change events to the `user-events` topic. The
authenticated `user-event-worker` Cloud Run service consumes its push
subscription and updates the PostgreSQL read model. Events contain password
hashes only; GCP IAM restricts publishing and push invocation.

To create the first administrator, add a `bootstrap-secret` in Secret Manager (at least 32
bytes), re-run `./deploy.sh`, complete `/setup/admin`, then delete the secret and re-run.

## AI Assistance Disclosure

Tools: ChatGPT / Codex (GPT-6) and Claude Code (Opus 5.5). Modes: boilerplate generation, implementation, debugging,
documentation, and verification. Supplier-service setup assistance is recorded
in the [service README](supplier-service/README.md). The exact Drizzle setup
prompt, subsequent TypeScript configuration fix, schema implementation and migration,
CSV-derived seed implementation, local database connection fix, GET suppliers route,
Nuxt frontend implementation, supplier authentication, administrator POST/PUT/DELETE
routes, and type/building list routes (implemented to the student's stated design choices), key responses, affected files,
and review status are in the
[AI usage log](AI_USAGE_LOG.md).

Drizzle assistance covers connection and tooling boilerplate and implementation
of the student-defined database schema. Database schema and architecture decisions
remain with the student. Prior setup was reviewed; the latest schema, migration, and seed
changes await student review.
Link this README from the submission slide deck when it is created.
