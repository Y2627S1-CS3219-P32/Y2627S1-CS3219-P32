-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
-- Scope: Drizzle-generated migration for student-defined group orders.
-- Author review: Pending.
CREATE TABLE "order_members" (
	"order_id" uuid NOT NULL,
	"user_id" integer NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_members_order_id_user_id_pk" PRIMARY KEY("order_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "order_events" DROP CONSTRAINT "order_events_state_check";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_current_state_check";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "is_group_order" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "order_members" ADD CONSTRAINT "order_members_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_members" ADD CONSTRAINT "order_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_members_user_idx" ON "order_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_state_check" CHECK ("order_events"."state" in ('SYNCHRONISING', 'PENDING', 'OPEN', 'REJECTED', 'ABORTED', 'ACCEPTED', 'CANCELLED', 'EXPIRED', 'PICKED_UP', 'DELIVERED', 'COMPLETE', 'SETTLED'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_current_state_check" CHECK ("orders"."current_state" in ('SYNCHRONISING', 'PENDING', 'OPEN', 'REJECTED', 'ABORTED', 'ACCEPTED', 'CANCELLED', 'EXPIRED', 'PICKED_UP', 'DELIVERED', 'COMPLETE', 'SETTLED'));