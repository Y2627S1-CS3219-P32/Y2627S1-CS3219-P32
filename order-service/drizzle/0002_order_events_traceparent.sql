-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-11-05.
-- Scope: Drizzle-generated migration: the trace each outbox row was written in, so the
-- relay publishes it in that trace. Author review: Pending.
ALTER TABLE "order_events" ADD COLUMN "traceparent" text;
