# Mandate Service

Mandate owns pending terms, immutable constraints, explicit owner approval, lifecycle transitions, coverage checks, and a transactional approval outbox. Agent never accesses its database.

Run `npm start --workspace mandate-service` after `npm run build --workspace mandate-service`, or follow the [local Compose setup](../agent-service/docs/agent-deployment.md). Supply `DATABASE_URL`, `JWT_SECRET`, service authentication settings, `PUBSUB_PROJECT_ID`, and `MANDATE_TOPIC`.

The single initial migration `migrations/0000_mandates.sql` creates the current schema and restricted runtime role. See the local setup guide before using it with a database that applied the earlier migration history.

Public routes list/read mandates and approve, pause, resume, or revoke them. Approval requires `{consent:true,terms_hash}` matching the reviewed terms. Internal routes create pending mandates and read context, an individual mandate, or creation coverage. Internal service identity cannot approve terms.

Supported constraints are supplier ID whitelists and one maximum credit reward per order. An absent constraint type is unrestricted; zero is a real amount limit. There are no recurring schedules, cumulative budgets, signatures, or spending ledgers.

Cancellation does not require a mandate. Order Service independently enforces requester ownership and order state.

Mandate owns its validation, database access, and approval publisher. It shares no source or runtime package with Agent. The services communicate through HTTP and Pub/Sub. `src/app.ts` mounts Express middleware and the public and internal routers in `src/handlers/routes.ts`. `src/handlers/http.ts` handles authentication and errors. `src/main.ts` owns startup, background work, and shutdown.

Run `npm run test:boundaries` from the repository root to check service isolation. Run `npm run test:contracts` to check HTTP helpers and the independently maintained wire contracts.
