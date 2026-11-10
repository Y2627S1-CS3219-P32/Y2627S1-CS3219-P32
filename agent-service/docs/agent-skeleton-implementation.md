# Agent runtime behavior

This is the current implementation reference. The [older technical design](agent-orchestrator-redesign-td.md) is historical where it differs.

## Acceptance and persistence

Chat authenticates users at the HTTP boundary. In one transaction it locks the owner-scoped conversation, allocates a message sequence, and inserts the trigger, processing turn, and turn outbox. Identical request retries return the saved IDs; conflicting text returns 409. The outbox publishes IDs in trigger order and marks them after broker acceptance.

The existing conversation attempt column is removed by a forward migration; Mandate and Order schemas are unchanged. Migration jobs run with owner credentials; each runtime uses an existing restricted database role. Order idempotency uses the existing unique `order_events.command_id` and JSON event payload.

## Execution and recovery

Workers acquire capacity before pulling and renew the delivery lease while waiting and working. A dedicated PostgreSQL session owns the conversation advisory lock. Execution writes use that session; remote calls run without an open transaction. A later turn cannot execute before an earlier processing trigger.

Model context contains completed prior turns and the current trigger, excluding later queued messages. Intermediate text, calls, and results remain in memory. Retries run in memory, bounded to three executions per delivery within one turn deadline. Every execution uses a fresh `stream_id` and resets provisional frontend output; no retry counter is saved. A terminal turn returns its saved status without executing again.

Complete messages and terminal status commit together. Redis completion notifications happen afterward and cannot roll back the database. Existing pending mandates for the current turn are recovered by business key after interruption. Approval commits a new continuation and outbox before its delivery is acknowledged.

## Tools and authorization

The registry contains `search_suppliers`, `get_order`, `propose_mandate`, `get_mandate`, `place_order`, and `cancel_order`. Complete input batches are validated before execution. Identity, destination URLs, credentials, and operation keys come from trusted runtime state.

Creation requires current owner-scoped mandate coverage. Cancellation requires ownership and a cancellable state in Order Service, without a mandate check. Creation uses `turn_id` directly as `command_id`; cancellation derives a stable UUID from the turn and order IDs in Agent. Order accepts that ID as an input and writes it to the existing event `command_id`. Repeated IDs with changed creation details are rejected by comparing the saved event fields directly. Each turn can create one order; an approval continuation is a new turn with its own key.

Proposals verify supplier IDs, then persist pending immutable terms in Mandate. Approval requires the authenticated owner, explicit consent, and the exact terms hash. Lifecycle transitions cannot change approved terms or reactivate terminal mandates. Static supplier and maximum-reward constraints apply independently to each creation; missing types mean unrestricted.

## Streaming and limits

The server-only model adapter uses SoC LLaaS streaming Chat Completions. It buffers fragmented tool arguments until complete, bounds outputs and context, and rejects interrupted responses. Worker limits bound model steps, calls, tokens, bytes, duration, and three in-memory executions. Pub/Sub bounds repeated delivery failures with a dead-letter policy.

SSE supports independent Redis replay cursors, heartbeats, bounded client buffering, disconnect cancellation, and token expiry. Invalid or trimmed cursors trigger durable history reload. The frontend deduplicates events and discards retired execution streams, reloads history after reconnect/completion, and periodically reconciles saved turn state.

Scheduling, recurrence, automatic reward escalation, and chat deletion are not implemented.
