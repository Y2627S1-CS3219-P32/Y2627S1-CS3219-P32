# Agent Chat

Chat verifies user JWTs and owns conversations, message acceptance, canonical history, SSE, the turn outbox, and mandate approval consumption.

Start with `npm start --workspace agent-chat-service` after the root build, or use the [local Compose setup](../docs/agent-deployment.md). Required settings are `DATABASE_URL`, `JWT_SECRET`, `REDIS_URL`, `PUBSUB_PROJECT_ID`, `TURN_TOPIC`, and `APPROVAL_SUBSCRIPTION`.

Routes are `GET/POST /conversations`, `GET/POST /conversations/:id/messages`, and `GET /conversations/:id/events`. Lists and history return `items` and `next_cursor`; message acceptance returns 202. Request IDs beginning with `approval:` are reserved for verified approval events.

`src/app.ts` mounts Express middleware and the routers in `src/handlers/routes.ts`. SSE runs in `src/handlers/conversationEventsHandler.ts`. HTTP messages and verified approval events both call `submitTurn` in `src/services.ts`, which owns idempotency and transaction boundaries. `src/handlers/mandateApprovalHandler.ts` matches approval events to completed proposals before submission. `src/repository.ts` owns database queries and writes.

The frontend forwards its HTTP-only session token as a bearer header. SSE disconnects when the token expires and requires a valid session on reconnect. Redis events are provisional; saved history is authoritative.
