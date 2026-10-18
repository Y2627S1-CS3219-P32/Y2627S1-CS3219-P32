-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
-- Scope: Drizzle-generated migration for supplier_event_sequence and the supplier_events outbox.
-- Author review: Pending.
CREATE SEQUENCE "public"."supplier_event_sequence" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "supplier_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" bigint DEFAULT nextval('supplier_event_sequence') NOT NULL,
	"type" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "supplier_events_version_unique" UNIQUE("version"),
	CONSTRAINT "supplier_events_type_check" CHECK ("supplier_events"."type" in ('supplier.created', 'supplier.updated', 'supplier.deleted')),
	CONSTRAINT "supplier_events_payload_check" CHECK (("supplier_events"."type" = 'supplier.deleted') = ("supplier_events"."payload" is null))
);
--> statement-breakpoint
CREATE INDEX "supplier_events_unpublished_idx" ON "supplier_events" USING btree ("version") WHERE "supplier_events"."published_at" is null;