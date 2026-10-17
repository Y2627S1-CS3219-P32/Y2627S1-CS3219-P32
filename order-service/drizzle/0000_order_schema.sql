-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
-- Scope: Drizzle-generated migration from the student-defined order-service schema.
-- Author review: Pending.
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"state" text NOT NULL,
	"actor_id" integer,
	"command_id" uuid,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "order_events_command_id_unique" UNIQUE("command_id"),
	CONSTRAINT "order_events_order_sequence_unique" UNIQUE("order_id","sequence"),
	CONSTRAINT "order_events_state_check" CHECK ("order_events"."state" in ('PENDING', 'OPEN', 'REJECTED', 'ABORTED', 'ACCEPTED', 'CANCELLED', 'EXPIRED', 'PICKED_UP', 'DELIVERED', 'COMPLETE', 'SETTLED'))
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" integer NOT NULL,
	"courier_id" integer,
	"supplier_id" uuid NOT NULL,
	"supplier_version" bigint NOT NULL,
	"description" text NOT NULL,
	"delivery_location" text NOT NULL,
	"credit_reward" integer NOT NULL,
	"current_state" text NOT NULL,
	"accepted_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_credit_reward_check" CHECK ("orders"."credit_reward" > 0),
	CONSTRAINT "orders_current_state_check" CHECK ("orders"."current_state" in ('PENDING', 'OPEN', 'REJECTED', 'ABORTED', 'ACCEPTED', 'CANCELLED', 'EXPIRED', 'PICKED_UP', 'DELIVERED', 'COMPLETE', 'SETTLED'))
);
--> statement-breakpoint
CREATE TABLE "supplier_versions" (
	"supplier_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"deleted" boolean NOT NULL,
	"name" varchar(256),
	"type" varchar(256),
	"building_name" varchar(256),
	"floor" varchar(256),
	"location_description" varchar(256),
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"is_active" boolean,
	"operating_hours" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_versions_supplier_id_version_pk" PRIMARY KEY("supplier_id","version"),
	CONSTRAINT "supplier_versions_details_check" CHECK ("supplier_versions"."deleted" or ("supplier_versions"."name" is not null and "supplier_versions"."type" is not null and "supplier_versions"."latitude" is not null and "supplier_versions"."longitude" is not null and "supplier_versions"."is_active" is not null and "supplier_versions"."operating_hours" is not null))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY NOT NULL,
	"display_name" text,
	"role" text,
	"version" bigint NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_details_check" CHECK ("users"."deleted_at" is not null or ("users"."display_name" is not null and "users"."role" is not null))
);
--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_courier_id_users_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_supplier_version_fk" FOREIGN KEY ("supplier_id","supplier_version") REFERENCES "public"."supplier_versions"("supplier_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_events_unpublished_idx" ON "order_events" USING btree ("created_at") WHERE "order_events"."published_at" is null;--> statement-breakpoint
CREATE INDEX "orders_state_reward_idx" ON "orders" USING btree ("current_state","credit_reward","id");--> statement-breakpoint
CREATE INDEX "orders_state_created_idx" ON "orders" USING btree ("current_state","created_at","id");--> statement-breakpoint
CREATE INDEX "orders_requester_created_idx" ON "orders" USING btree ("requester_id","created_at","id");--> statement-breakpoint
CREATE INDEX "orders_supplier_idx" ON "orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "orders_open_expiry_idx" ON "orders" USING btree ("expires_at") WHERE "orders"."current_state" = 'OPEN';