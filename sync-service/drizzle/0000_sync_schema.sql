-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
-- Scope: Drizzle-generated migration for the sync-service tables.
-- Author review: Pending.
CREATE TABLE "document_members" (
	"order_id" uuid NOT NULL,
	"user_id" integer NOT NULL,
	CONSTRAINT "document_members_order_id_user_id_pk" PRIMARY KEY("order_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "document_updates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"update" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"requester_id" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_status_check" CHECK ("documents"."status" in ('open', 'placed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "document_members" ADD CONSTRAINT "document_members_order_id_documents_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."documents"("order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_updates" ADD CONSTRAINT "document_updates_order_id_documents_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."documents"("order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_updates_order_idx" ON "document_updates" USING btree ("order_id","id");