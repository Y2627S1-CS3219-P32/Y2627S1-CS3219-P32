/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-11-04.
 * Scope: OpenTelemetry bootstrap for the backend services: traces, metrics and logs over
 * OTLP to the local collector in compose.observability.yaml. Author review: Pending.
 *
 * Loaded before the service's own code, so the instrumentations can patch express, pg,
 * pino and http as they are first imported:
 *
 *   node --import ./dist/shared/telemetry.mjs dist/index.js
 *   tsx --import ./src/shared/telemetry.mts src/index.ts
 *
 * It does nothing unless OTEL_EXPORTER_OTLP_ENDPOINT is set, which compose.observability.yaml
 * does, and deploy.sh on Cloud Run with OBSERVABILITY=on, so tests and plain
 * `docker compose up` run without it. Every other
 * standard OTEL_* variable (OTEL_SERVICE_NAME, OTEL_METRIC_EXPORT_INTERVAL, OTEL_LOG_LEVEL,
 * OTEL_SDK_DISABLED, ...) works as documented.
 *
 * What it records:
 *   traces   incoming and outgoing HTTP (http, fetch), Express routes, PostgreSQL queries.
 *            W3C traceparent headers carry the trace across HTTP calls between services.
 *   metrics  HTTP request durations by route and status, and Node.js runtime metrics
 *            (event loop delay, heap, GC).
 *   logs     every pino log line, with the trace and span it was written in. They still go
 *            to stdout as before; trace_id and span_id are added there too.
 *
 * This is an .mts file so it is an ES module, with top-level await, in user-service too.
 *
 * Claude Code (Opus 5.5), 2026-11-10: a service.instance.id for each process; Cloud Run
 * (deploy.sh) sets the endpoint while the `observability` service is deployed.
 * Author review: Pending.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { constants } from "node:os";

// As in logger.ts. Repeated so this file needs nothing else from shared/src, which lets
// frontend-service run it without compiling (Node strips the types).
function serviceName(): string {
  const configured = process.env.OTEL_SERVICE_NAME || process.env.K_SERVICE;
  if (configured) return configured;
  try {
    const { name } = JSON.parse(readFileSync("package.json", "utf8")) as { name?: unknown };
    if (typeof name === "string" && name) return name;
  } catch {
    // Not started from the service folder.
  }
  return "unknown-service";
}

// Health checks run every few seconds and would bury real requests.
const isHealthCheck = (path: string | undefined) => /^\/health(\/|\?|$)/.test(path ?? "");

// Pub/Sub push endpoints carry the internal shared secret as ?token=.
const redactedQueryParams = [
  "token",
  "ticket",
  "sig",
  "Signature",
  "X-Goog-Signature",
  "X-Goog-Credential",
];

// The http instrumentation redacts these itself; the fetch (undici) one does not.
function redactedUrlAttributes(request: { origin: string; path: string }) {
  const url = new URL(request.path, request.origin);
  const sensitive = redactedQueryParams.filter((param) => url.searchParams.has(param));
  if (sensitive.length === 0) return {};
  for (const param of sensitive) url.searchParams.set(param, "REDACTED");
  return { "url.full": url.toString(), "url.query": url.search };
}

// Tells apart the instances of a service, whose metrics would otherwise be one series: on
// Cloud Run they all have the same host name. OTEL_RESOURCE_ATTRIBUTES can still set it.
function addServiceInstanceId(): void {
  const attributes = process.env.OTEL_RESOURCE_ATTRIBUTES ?? "";
  if (/(^|,)\s*service\.instance\.id\s*=/.test(attributes)) return;
  process.env.OTEL_RESOURCE_ATTRIBUTES = [attributes, `service.instance.id=${randomUUID()}`]
    .filter(Boolean)
    .join(",");
}

async function start(): Promise<void> {
  addServiceInstanceId();

  // ES modules are linked before any of them runs, so patching them takes a loader hook
  // registered here, before the service's imports are resolved. The message channel limits
  // the hook to the modules the instrumentations below ask for.
  const { createAddHookMessageChannel } = await import("import-in-the-middle");
  const { registerOptions, waitForAllMessagesAcknowledged } = createAddHookMessageChannel();
  register("import-in-the-middle/hook.mjs", import.meta.url, registerOptions);

  const [
    { NodeSDK },
    { HttpInstrumentation },
    { UndiciInstrumentation },
    { ExpressInstrumentation },
    { PgInstrumentation },
    { PinoInstrumentation },
    { RuntimeNodeInstrumentation },
  ] = await Promise.all([
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/instrumentation-http"),
    import("@opentelemetry/instrumentation-undici"),
    import("@opentelemetry/instrumentation-express"),
    import("@opentelemetry/instrumentation-pg"),
    import("@opentelemetry/instrumentation-pino"),
    import("@opentelemetry/instrumentation-runtime-node"),
  ]);

  // Exporters, protocol (http/protobuf) and intervals come from the OTEL_* environment.
  const sdk = new NodeSDK({
    serviceName: serviceName(),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (request) => isHealthCheck(request.url),
        redactedQueryParams,
        redactedQueryParamsServer: redactedQueryParams,
      }),
      new UndiciInstrumentation({ startSpanHook: redactedUrlAttributes }),
      new ExpressInstrumentation(),
      // Only queries made while handling something: outbox pollers and readiness checks
      // query every second or so, and would each start a trace of their own.
      new PgInstrumentation({ requireParentSpan: true }),
      new PinoInstrumentation(),
      new RuntimeNodeInstrumentation(),
    ],
  });
  sdk.start();
  await waitForAllMessagesAcknowledged();

  // Flush what is buffered when the container is stopped.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      // Listeners the service added itself, which decide how it exits.
      const serviceHandlesSignal = process.listenerCount(signal) > 0;
      void sdk
        .shutdown()
        .catch(() => undefined)
        .finally(() => {
          // Otherwise this listener has replaced Node's default, so exit with the code a
          // signal would give. (Re-raising it would not do: as PID 1 in a container, Node
          // ignores a signal it has no listener for, until Docker kills it 10 s later.)
          if (!serviceHandlesSignal) process.exit(128 + constants.signals[signal]);
        });
    });
  }
}

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT && process.env.OTEL_SDK_DISABLED !== "true") {
  await start();
}
