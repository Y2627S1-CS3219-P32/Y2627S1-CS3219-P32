# Agent Orchestrator

The pull worker executes ordered turns with bounded concurrency, PostgreSQL advisory locks, delivery lease renewal, whole-turn retries, and atomic completion persistence. Remote calls run outside database transactions.

Start with `npm start --workspace agent-orchestrator-service` after the root build, or use the [local Compose setup](../docs/agent-deployment.md). Supply the execution-role `DATABASE_URL`, Pub/Sub subscription, Redis, service destinations/authentication, and `SOCLAAS_API_KEY`, `SOCLAAS_MODEL`, and optional `SOCLAAS_BASE_URL`.

The model uses streaming Chat Completions with registered tools. Complete argument batches are validated before execution. Limits live in `src/config.ts`; each delivery has up to three executions in an in-memory retry loop within one turn deadline. No retry counter is persisted. A worker restart resets the local retry budget; Pub/Sub handles delivery failures through its dead-letter policy.

`src/llm/` contains the model client, system prompt, and `tools/` modules. `src/services.ts` coordinates turn execution, with helpers in the same file for model steps, tool batches, stream events, and completion persistence. External service clients remain in `src/clients/`.

Cancellation checks ownership and lifecycle in Order Service and requires no mandate. Creation requires coverage immediately before a new write. Both POST directly to Order with stable command IDs derived from the accepted turn ID; Order deduplicates repeated writes using its existing event log. Each execution publishes a fresh `stream_id` so clients discard interrupted output.
