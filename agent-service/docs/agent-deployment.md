# Run the agent services

<!-- AI Assistance Disclosure: Codex (GPT-6.1), 2026-11-10: update host ports after rebase. Author review: Pending. -->

## Start locally

1. Install dependencies with `npm ci` at the root and in `frontend-service`, `order-service`, and `supplier-service`.
2. Set a shared `JWT_SECRET` of at least 32 characters in the root `.env`. Set `SOCLAAS_API_KEY`, `SOCLAAS_MODEL` (for example, `default`), and optionally `SOCLAAS_BASE_URL`.
3. Run `docker compose --profile agent-skeleton up --build` from the repository root. The profile name is retained for compatibility.
4. Open the frontend and sign in. Use **Friend** for chat and **Mandates** to review authorizations.

Compose applies one initial migration per Conversation and Mandate database, provisions local restricted runtime logins, and starts the turn and approval outbox consumers. Conversation and Mandate databases retain their named volumes. Redis is local-only with no published host port.

These initial migrations replace the earlier Conversation and Mandate migration histories. Existing databases require an explicit migration-history reconciliation or a reset before using this baseline. For disposable local data, stop Compose and remove only the Conversation and Mandate volumes before restarting. A reset deletes their data.

Agent Chat listens on host port 3008; Mandate listens on 3009. Ports 3006 and 3007 are reserved for order chat and order ranking. The frontend's `NUXT_AGENT_SERVICE_BASE_URL` and `NUXT_MANDATE_SERVICE_BASE_URL` point to these services. Model credentials are supplied only to Orchestrator.

## Verify changes

Run root `npm run build` and `npm run typecheck`, then `npm run typecheck --prefix frontend-service` and `npm run build --prefix frontend-service`.

Run `npm run test:connections` with Docker available. It creates isolated PostgreSQL, Redis, and Pub/Sub containers, runs adapter checks, the complete backend flow with a deterministic local model, and existing Order/Supplier tests, then removes its test infrastructure. The flow covers restricted database roles, duplicate submissions, retries, ordering, approval redelivery, and cancellation after mandate revocation.

Run `npm run test --workspace mandate-service` for constraint and coverage tests. Run `node agent-service/scripts/sync-frontend-types.mjs --check` for frontend contract freshness.

To verify the actual configured SoC LLaaS model, run `node agent-service/scripts/check-model.mjs` after building. This makes two model requests using `.env`, verifies streamed text and a tool call, and never logs the key.

## Prepare production

`./deploy.sh setup` automatically creates the Conversation and Mandate databases, generates their owner/runtime connection secrets, and provisions private Memorystore Redis with AUTH and TLS. It also creates a Cloud Router and NAT so Orchestrator can reach both internal services and the external model API. If the subnet already has Cloud NAT, set `AGENT_ROUTER` and `AGENT_NAT` to its existing router and NAT names.

Run `./deploy.sh soclass` once to configure the SoC LLaaS key, model, and optional base URL. Then build with `cloudbuild.yaml` and run `./deploy.sh`. Deployment also ensures these resources exist, applies one migration per database, provisions restricted runtime logins, creates Pub/Sub resources, and wires the frontend URLs. Database and Redis secrets require no manual entry. Existing database secrets are reused; Redis connection and CA secrets are refreshed from the instance.

Chat and Orchestrator share the Conversation database and use separate logins bound to `agent_chat` and `agent_execution`. Mandate uses its own database and the `mandate_runtime` role. Migration owner credentials are only supplied to migration/provisioning jobs. The project-level `jwt-secret` is created by the existing setup flow.

The Redis instance defaults to `agent-redis` (1 GiB, Basic tier); set `AGENT_REDIS_INSTANCE` to override the name. Setup creates billable Memorystore and Cloud NAT resources. For GitHub Actions, re-run `./deploy.sh github` once to grant the deployer Redis and network administration permissions.

Give Chat turn-topic publication and approval-subscription consumption. Give Orchestrator turn-subscription consumption and model-secret access. Give Mandate approval-topic publication. Permit metadata reads for readiness on those same topics/subscriptions. Configure the turn subscription to forward to a dead-letter topic after approximately five delivery attempts, and grant the Pub/Sub service agent subscriber access on the source and publisher access on that topic. The local provisioning script sets the same policy. Inspect and resolve dead-lettered turns before allowing later work in that conversation.

Configure continuously allocated CPU and at least one instance for pull workers and outbox loops. Configure Chat for long SSE connections. Route browser calls through the frontend's same-origin session proxy. The endpoints `/health/live` and `/health/ready` distinguish process liveness from required adapter availability.

## Connection layer

Outgoing domain calls use `ORDER_SERVICE_URL`, `SUPPLIER_SERVICE_URL`, `MANDATE_SERVICE_URL`, `CREDIT_SERVICE_URL`, and `SERVICE_AUTH_MODE`. In local mode, set the corresponding `*_SERVICE_SECRET` values. Order and Credit use their existing internal secrets; Supplier uses its read-secret allowlist. Mandate accepts `MANDATE_SERVICE_SECRET` on internal routes only. Credit exposes `POST /internal/credits/balance` for the read-only `get_credit_balance` tool; the user ID comes from execution context, never model arguments.

In Google mode, configure destination `*_SERVICE_AUDIENCE` values. At Order and Credit use `INTERNAL_AUDIENCE` and `INTERNAL_INVOKER_EMAILS`; at Supplier use `SERVICE_READ_AUDIENCE` and `SERVICE_READ_INVOKERS`. Mandate validates its audience and `INTERNAL_INVOKER_EMAILS`. Credit's internal read allowlist must include the agent runtime service account; `deploy.sh` accepts this as `CREDIT_INTERNAL_INVOKER_EMAILS`. Its Pub/Sub caller allowlist remains separate. Use HTTPS and grant only required Cloud Run invoker permissions.

Supply private authenticated Redis via `rediss://`. Streams retain approximately 1,000 events and permit at most 50 reader connections per adapter. Saved conversation history remains canonical after Redis failure. Verify production IAM and actual model capabilities with deployment smoke tests before routing users to the services.

Deploy Chat, Orchestrator, and the frontend together when changing the SSE envelope: execution identity is now `stream_id`, with no persisted attempt counter.
