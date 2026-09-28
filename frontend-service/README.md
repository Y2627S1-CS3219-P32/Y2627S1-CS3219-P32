<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
Scope: Nuxt frontend setup and service organisation. Author review: Done. -->
# Frontend service

Nuxt frontend for Friend on Campus. The supplier directory uses the existing
GET /suppliers endpoint, with name/type filters, joined building/type names,
open-first ordering, and loading, empty, and error states.

## Docker

From the repository root:

```sh
docker compose up -d --build frontend-service
```

Open **http://127.0.0.1:3001**. The frontend has no Compose dependency on
supplier-service, so it starts on its own. Start supplier-service separately
(`docker compose up -d supplier-service`) for supplier data; until it responds,
the directory shows its error state with a retry button. The frontend image has its own dependencies, lockfile, and multi-stage build;
its runtime contains only Nuxt's generated `.output` and runs as the Node user.

Requests follow this path:

```text
Browser -> localhost:3001/api/supplier-service/suppliers
        -> Nuxt server -> http://supplier-service:3000/suppliers
```

All services use Compose's default network. The browser uses a same-origin Nuxt
endpoint; Docker's service hostname stays on the Nuxt server. The private runtime
setting `NUXT_SUPPLIER_SERVICE_BASE_URL` is set by Compose and can be changed at
container startup. The frontend does not connect directly to PostgreSQL.

## Local development

Start the backend with `docker compose up -d supplier-service` from the root.
Then, from `frontend-service/`:

```sh
npm ci
npm run dev
```

Development runs on port 3001 and connects to the supplier API at
`http://127.0.0.1:3000` by default. Copy `.env.example` to `.env` to override it.

```sh
npm run typecheck
npm run build
npm run preview
```

`npm run preview` serves the built frontend on port 3001. `npm start` runs Nitro
directly; set `NITRO_PORT=3001` when using it alongside the host supplier API.
Install dependencies here, independently of the backend services.

## Code organisation

```text
app/
  app.vue                       shared shell
  pages/index.vue               thin route entry point
  assets/css/main.css           shared visual styles
  services/
    supplier-service/           supplier components and useSuppliers
    user-service/               reserved for user features
    order-service/              reserved for order features
    credit-service/             reserved for credit features
server/
  api/supplier-service/         same-origin HTTP route
  services/supplier-service/    internal supplier API client
shared/services/supplier-service/types.ts
public/images/suppliers/        copies of the supplied data/images assets
```

Keep new features with their owning service. Shared service types describe API
responses; they do not import backend code or database dependencies. Only the
supplier service currently exposes a frontend feature; the other service folders
document where their future implementation belongs.

Supplier photos are copied from the repository's six `data/images` assets, so
the supplied GitHub blob URLs render without external image requests. Other
suppliers use initials. Map links open Google Maps using the API coordinates.
The directory preserves the API's ordering. Type choices come from fetched
supplier data and remain available while filtering.

## AI assistance disclosure

ChatGPT / Codex (GPT-6) generated this scaffold, UI, configuration, documentation,
and verification work on 2026-09-28. Exact prompt: `build a frontend service
(nuxtjs). edit the compose file, add a dependency on the supplier service. the
frontend will call supplier-service on the same network. do ensure the segregation
of the code on the frontend as well (separated by the services you see in the
folder). you may shift the port numbers around (since supplier service is on 3000
already) to avoid clashing. the service will have its own dependencies as well, do
manage that`. Claude Code (Claude Opus 5.5) then changed the shared supplier type
imports to Nuxt's `#shared` alias so `nuxt typecheck` passes, removed the Compose
dependency on supplier-service, and verified the build, typecheck, Compose startup,
API forwarding, and desktop and phone layouts. Human review is Done. The lockfile is npm-generated; supplier photographs are copied source assets.
References: [Nuxt directory structure](https://nuxt.com/docs/4.x/directory-structure),
[runtime configuration](https://nuxt.com/docs/4.x/guide/going-further/runtime-config),
and [deployment](https://nuxt.com/docs/4.x/getting-started/deployment).
