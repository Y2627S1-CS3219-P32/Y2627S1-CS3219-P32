<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-11-04.
Scope: Shared code instructions. Author review: Pending.
Claude Code (Opus 5.5), 2026-11-04: the OpenTelemetry bootstrap. Author review: Pending.
Claude Code (Opus 5.5), 2026-11-05: Pub/Sub message logs and traces. Author review: Pending.
Claude Code (Opus 5.5), 2026-11-10: log messages that describe each message. Author review: Pending.
Claude Code (Opus 5.5), 2026-11-10: the chat, mail, order-ranking and sync services; the `level`
option. Author review: Pending.
Claude Code (Opus 5.5), 2026-11-10: Cloud Run telemetry settings; service.instance.id.
Author review: Pending. -->
# Shared code

Code used by more than one backend service: the logger,
[`src/logger.ts`](src/logger.ts), built on [pino](https://getpino.io), the
OpenTelemetry bootstrap, [`src/telemetry.mts`](src/telemetry.mts), and the Pub/Sub
message logging and tracing in [`src/messaging.ts`](src/messaging.ts).
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
import { logger } from "./shared/logger.js"; // user-service, mail-service: "./shared/logger"

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
tsx --import ./src/shared/telemetry.mts src/index.ts      # user-service, mail-service, compose.dev.yaml
node --import ./otel/telemetry.mts .output/server/index.mjs   # frontend-service image
```

It does nothing unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set. `compose.observability.yaml`
sets it on every app service, so telemetry is on with that file and off without it (and in
tests). On Cloud Run, `OBSERVABILITY=on ./deploy.sh` sets it, with the `x-otlp-token` header
(`OTEL_EXPORTER_OTLP_HEADERS`) and `OTEL_TRACES_SAMPLER=always_on`; see the
[root README](../README.md#observability-on-cloud-run). With it on, each service sends over
OTLP (HTTP/protobuf):

| Signal | What |
| --- | --- |
| Traces | Incoming and outgoing HTTP (`http`, `fetch`), Express routes and middleware, PostgreSQL queries made while handling a request or message, and every Pub/Sub message sent and processed (see [Pub/Sub messages](#pubsub-messages)). `traceparent` headers carry a trace from frontend-service into the backends, and message attributes carry it on through Pub/Sub. |
| Metrics | `http.server.request.duration` and `http.client.request.duration` by route and status; Node.js event loop delay, heap and GC. |
| Logs | Every pino line, linked to the trace and span it was written in. They still go to stdout, now with `trace_id` and `span_id`. |

It leaves out `/health` requests and `pg` queries without a parent span (outbox pollers and
readiness checks), and replaces `token`, `ticket` and signature query parameters in
recorded URLs with `REDACTED`, since the Pub/Sub push endpoints carry the internal secret
as `?token=`.

Each process adds a random `service.instance.id` to `OTEL_RESOURCE_ATTRIBUTES` (unless that
sets one), so the metrics of several instances of a service, which on Cloud Run share a host
name, stay apart.

Any standard `OTEL_*` variable works, for example `OTEL_SERVICE_NAME` (otherwise
`K_SERVICE`, then the `package.json` name, as for the logger), `OTEL_METRIC_EXPORT_INTERVAL`,
`OTEL_LOG_LEVEL=debug` to see the SDK's own errors, or `OTEL_SDK_DISABLED=true`.

Notes:

- It is an `.mts` file so it is an ES module, with top-level await, in user-service and
  mail-service (CommonJS) too. The service `tsconfig.json` files include `src/**/*.mts`.
  chat-service compiles `src/` to `dist/src/`, so it loads `./dist/src/shared/telemetry.mjs`.
- It imports nothing else from `shared/src`, so frontend-service can run it uncompiled:
  its image installs the packages from
  [`frontend-service/telemetry/package.json`](../frontend-service/telemetry/package.json)
  and Node strips the types.
- On Windows, `tsx watch` hangs while loading it, so the `dev` scripts in `package.json`
  do not load it. `compose.dev.yaml` runs `tsx watch` in Linux, where it works.

## Pub/Sub messages

Every message the services publish or receive goes through
[`src/messaging.ts`](src/messaging.ts), which writes one log line on each side and, with
telemetry on, a span:

```ts
import { publishMessage, receivePush, processMessage, withTraceparent } from "./shared/messaging.js";

await publishMessage(topic, { json, orderingKey, attributes });  // instead of topic.publishMessage
router.post("/pubsub/order-events", receivePush(async (req: Request, res: Response) => { ... }));
subscription.on("message", (m) => processMessage(name, m, async () => "ack"));  // pull
await publishMessage(topic, message, { level: "debug" });                    // frequent messages
```

`{ level: "debug" }` (on `publishMessage` and `processMessage`) logs the success line at debug,
for messages too frequent to read at info; failures stay warn or error. sync-service uses it
for the live edits and presence it relays between its instances (`sync.update`,
`sync.awareness`); its `sync.status` changes and `group.placed` stay at info. Set
`LOG_LEVEL=debug` on sync-service to see them.

`receivePush` wraps the push route's handler rather than being a middleware: the Express
instrumentation makes the HTTP request's span current again at every `next()`, so only the
handler itself can run in the message's trace.

Each log message says what the message was, so the log list reads without opening entries:

```text
Published order.created to order-events: orderId=271b… supplierId=4cb3… requesterId=4 actorId=4 state=PENDING creditReward=7 sequence=1 (message 9)
Processed order.created from saga-orchestrator-order-events in 104 ms: orderId=271b… … (message 9)
Published credit.reserve to credit-commands: orderId=271b… requesterId=4 amount=7 (message 10)
Did not acknowledge user.verified from credit-service-user-events (HTTP 400) after 4 ms, so Pub/Sub will redeliver it: userId=4 … (message 8)
```

| Message starts with | Level | When |
| --- | --- | --- |
| `Published <type> to <topic>` | info | Pub/Sub accepted the message |
| `Processed <type> from <subscription> in <n> ms` | info | acknowledged |
| `Did not acknowledge <type> from <subscription>` | warn, or error for a push 5xx | not acknowledged (push: the HTTP status), so Pub/Sub redelivers it |
| `Failed to process <type> from <subscription>` | error | a pull handler threw; with `err` |
| `Push of <type> from <subscription> closed …` | warn | the push connection closed before a response |

After the colon come the message's key fields, from `SUMMARY_FIELDS` in
[`src/messaging.ts`](src/messaging.ts): ids (`orderId`, `userId`, `supplierId`,
`requesterId`, `courierId`, `actorId`, `senderId`, `placedBy`), `state`, `status`, `code`, `reservationState`,
`amount`, `creditReward`, `reason`, `role`, `displayName`, the verification status and
purpose, `isActive`, `applied`, `sequence` and `version`. They are read from the top level of
the message's JSON or one object down (`user.id` is shown as `userId`), and from the message's
attributes for what the JSON lacks (all of it, for sync-service's binary relay messages). Only
fields on that list are logged, so password hashes, verification codes, reset tokens, emails,
names, chat messages and other free text never are; add a field to the list to show it. `(message <id>)` is Pub/Sub's message id,
the same on both sides, with `attempt <n>` on a redelivery when the subscription counts
attempts (dead-letter policy).

The same values are also fields of the log entry, beside `topic` or `subscription`,
`messageId`, `eventType`, `orderingKey`, `attributes` and, when received, `outcome` (`ack` or
`nack`), `durationMs`, `deliveryDelayMs` (from publish to receipt), `deliveryAttempt` and, for
push, `statusCode`. In Grafana (**Explore → Loki**) they are structured metadata, so they
filter without a parser:

| To see | Query |
| --- | --- |
| Every message | `{service_name=~".+"} \| messageId != ""` |
| One order's messages, across services | `{service_name=~".+"} \| orderId="<id>"` |
| One message, publisher and every subscriber | `{service_name=~".+"} \| messageId="<id>"` |
| One kind | `{service_name=~".+"} \| eventType="order.created"` |
| Not acknowledged | `{service_name=~".+"} \| outcome="nack"` |

A failed publish is logged by the caller, which decides whether it is retried.

With telemetry on, publishing adds the trace to the message's attributes (`traceparent`),
and each subscriber processes the message in that trace, so one trace in Tempo follows a
request through every service its events and commands reach: for an order, from
frontend-service through order-service, the saga, credit-service and notification-service.
The spans are `send <topic>` and `process <subscription>`. A push request's own HTTP span
starts without trace context (Pub/Sub does not send it), so it is linked to the
`process` span instead.

The outbox tables (`order_events`, saga `outbox`, `supplier_events`, `credit_outbox`) have
a `traceparent` column, filled in on insert with the trace the row was written in. The
relay publishes each row in its own trace, even when it runs later or in another process,
as credit-publisher does:

```ts
traceparent: text("traceparent").$defaultFn(() => currentTraceparent() ?? sql`null`), // schema
await withTraceparent(row.traceparent, () => publish(...));                          // relay
```

Without telemetry the column stays null and only the log lines are written.
