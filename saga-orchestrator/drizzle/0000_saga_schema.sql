-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
-- Scope: Drizzle-generated migration for the saga orchestrator tables.
-- Author review: Pending.
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" text NOT NULL,
	"ordering_key" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "processed_messages" (
	"message_id" text PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sagas" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"correlation_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"courier_id" integer,
	"state" text NOT NULL,
	"reserve_request_id" uuid NOT NULL,
	"release_request_id" uuid,
	"transfer_request_id" uuid,
	"reserve_deadline" timestamp with time zone,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sagas_state_check" CHECK ("sagas"."state" in ('RESERVING', 'OPEN', 'REJECTED', 'ABORTED', 'RELEASING', 'RELEASED', 'TRANSFERRING', 'SETTLED', 'FAILED')),
	CONSTRAINT "sagas_amount_check" CHECK ("sagas"."amount" > 0)
);
--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox" USING btree ("created_at") WHERE "outbox"."published_at" is null;--> statement-breakpoint
CREATE INDEX "sagas_reserving_deadline_idx" ON "sagas" USING btree ("reserve_deadline") WHERE "sagas"."state" = 'RESERVING';