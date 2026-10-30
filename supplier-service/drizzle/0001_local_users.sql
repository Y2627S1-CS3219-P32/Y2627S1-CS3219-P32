-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
-- Scope: Drizzle-generated migration for the local users table fed by user-events.
-- Author review: Pending.
CREATE TABLE "users" (
	"id" integer PRIMARY KEY NOT NULL,
	"display_name" text,
	"role" text,
	"version" bigint NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_details_check" CHECK ("users"."deleted_at" is not null or ("users"."display_name" is not null and "users"."role" is not null))
);
