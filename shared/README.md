<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-11-04.
Scope: Shared code instructions. Author review: Pending.
Claude Code (Opus 5.5), 2026-11-04: the OpenTelemetry bootstrap. Author review: Pending. -->
# Shared code

Code used by more than one backend service: the logger,
[`src/logger.ts`](src/logger.ts), built on [pino](https://getpino.io), and the
OpenTelemetry bootstrap, [`src/telemetry.mts`](src/telemetry.mts).
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

## Telemetry

[`src/telemetry.mts`](src/telemetry.mts) starts the
[OpenTelemetry Node SDK](https://opentelemetry.io/docs/languages/js/) before the service's
own code, so it can patch modules as they are first imported. Every start command loads
it with `--import`:

```sh
node --import ./dist/shared/telemetry.mjs dist/index.js   # compiled services
tsx --import ./src/shared/telemetry.mts src/index.ts      # user-service, compose.dev.yaml
node --import ./otel/telemetry.mts .output/server/index.mjs   # frontend-service image
```

It does nothing unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set. `compose.observability.yaml`
sets it on every app service, so telemetry is on with that file and off without it (and in
tests and on Cloud Run). With it on, each service sends over OTLP (HTTP/protobuf):

| Signal | What |
| --- | --- |
| Traces | Incoming and outgoing HTTP (`http`, `fetch`), Express routes and middleware, and PostgreSQL queries made while handling a request. `traceparent` headers carry a trace from frontend-service into the backends. |
| Metrics | `http.server.request.duration` and `http.client.request.duration` by route and status; Node.js event loop delay, heap and GC. |
| Logs | Every pino line, linked to the trace and span it was written in. They still go to stdout, now with `trace_id` and `span_id`. |

It leaves out `/health` requests and `pg` queries without a parent span (outbox pollers and
readiness checks), and replaces `token`, `ticket` and signature query parameters in
recorded URLs with `REDACTED`, since the Pub/Sub push endpoints carry the internal secret
as `?token=`.

Any standard `OTEL_*` variable works, for example `OTEL_SERVICE_NAME` (otherwise
`K_SERVICE`, then the `package.json` name, as for the logger), `OTEL_METRIC_EXPORT_INTERVAL`,
`OTEL_LOG_LEVEL=debug` to see the SDK's own errors, or `OTEL_SDK_DISABLED=true`.

Notes:

- It is an `.mts` file so it is an ES module, with top-level await, in user-service
  (CommonJS) too. The service `tsconfig.json` files include `src/**/*.mts`.
- It imports nothing else from `shared/src`, so frontend-service can run it uncompiled:
  its image installs the packages from
  [`frontend-service/telemetry/package.json`](../frontend-service/telemetry/package.json)
  and Node strips the types.
- On Windows, `tsx watch` hangs while loading it, so the `dev` scripts in `package.json`
  do not load it. `compose.dev.yaml` runs `tsx watch` in Linux, where it works.
- Pub/Sub messages do not carry trace context yet, so work that one service starts in
  another through an event or command shows up as a separate trace.
