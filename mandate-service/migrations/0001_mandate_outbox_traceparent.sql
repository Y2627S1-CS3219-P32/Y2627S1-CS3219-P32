-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-11-10.
-- Scope: Drizzle-generated migration: the trace each outbox row was written in, so the
-- relay publishes it in that trace. Author review: Pending.
ALTER TABLE "mandate_outbox" ADD COLUMN "traceparent" text;
