<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-11-04.
Scope: Shared code instructions. Author review: Pending. -->
# Shared code

Code used by more than one backend service. Today that is the logger,
[`src/logger.ts`](src/logger.ts), built on [pino](https://getpino.io).
Edit files here only. The services get copies:

- **Docker** (Compose and Cloud Build): every backend build gets `shared/src` as an
  extra build context named `shared`, and its Dockerfile copies it into `src/shared/`.
  Building a backend image by hand needs the same flag, from the repository root:

  ```sh
  docker buildx build --build-context shared=shared/src order-service
  ```

- **Outside Docker** (`npm run dev`, `npm test`, your editor): run this once after cloning
  and again after changing anything in `shared/src`:

  ```sh
  node shared/sync.mjs
  ```

  It replaces each service's `src/shared/` with a fresh copy. Those folders are
  git-ignored, so never edit them.

- **`compose.dev.yaml`** syncs `shared/src` into the running containers on every change.

## Logger

```ts
import { logger } from "./shared/logger.js"; // user-service: "./shared/logger"

logger.info({ orderId }, "Order created");
logger.error({ err: error }, "Outbox relay failed"); // `err` keeps the stack trace
const log = logger.child({ component: "outbox" }); // adds component to every line
```

Each entry is one JSON line on stdout with `level`, `severity` (for Cloud Logging),
`time`, `service` and `message`. The logger replaces the values of
`req.headers.authorization`, `req.headers.cookie`, and any `password`, `passwordHash`,
`token`, `accessToken`, `refreshToken` or `secret` field (top level or one level down)
with `[REDACTED]`.

| Variable | Effect |
| --- | --- |
| `LOG_LEVEL` | `trace`, `debug`, `info` (default), `warn`, `error`, `fatal` or `silent` |
| `LOG_PRETTY=true` | Coloured, human-readable output via pino-pretty (a dev dependency, so not in production images). `compose.dev.yaml` sets it. |
| `OTEL_SERVICE_NAME` | The `service` field. Otherwise Cloud Run's `K_SERVICE`, then the `name` in the working directory's `package.json`. |
