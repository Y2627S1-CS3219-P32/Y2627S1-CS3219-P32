# Agent service

Chat owns authenticated conversation HTTP/SSE, message acceptance, the turn outbox, and approval continuations. Orchestrator owns ordered turn execution, model streaming, and the six domain tools. Mandate Service owns its separate database and user consent.

Run `npm ci && npm run build` from the repository root. See [local startup and deployment](docs/agent-deployment.md) and [runtime behavior](docs/agent-skeleton-implementation.md).

The `@campus/agent-contracts` workspace owns contracts, the conversation schema, and infrastructure adapters shared within Agent. Runtime repositories use separate restricted database logins. The single initial migration `db/migrations/0000_conversation.sql` creates the current schema and runtime roles.

An accepted `turn_id` is stable across worker retries. Order creation uses `turn_id` as its request ID; cancellation derives a stable UUID from the turn and order IDs in Agent. Order accepts the request ID directly and stores it in the existing event `command_id`, without extra operation metadata. Approval creates a new turn with its own ID.

Order creation requires current mandate coverage. Cancellation requires requester ownership and a cancellable order state; it does not call mandate coverage.

To regenerate the frontend's standalone type contracts after contract changes, run `node agent-service/scripts/sync-frontend-types.mjs`. Run it with `--check` to detect stale copies. The frontend Docker build remains independent of the root workspaces.

Agent and Mandate maintain separate code and validation schemas. They communicate through HTTP and Pub/Sub. Agent HTTP helpers live in `common/http.ts`; each application owns startup and shutdown in its `src/main.ts`. Run `npm run test:boundaries` and `npm run test:contracts` from the repository root to check isolation and contract compatibility.
