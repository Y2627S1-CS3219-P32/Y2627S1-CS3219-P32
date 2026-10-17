-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
-- Scope: Drizzle-generated migration from the student-defined notifications table.
-- Author review: Pending.
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"source" text NOT NULL,
	"event_id" uuid NOT NULL,
	"order_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_source_event_user_unique" UNIQUE("source","event_id","user_id"),
	CONSTRAINT "notifications_source_check" CHECK ("notifications"."source" in ('order', 'credit'))
);
--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" is null;