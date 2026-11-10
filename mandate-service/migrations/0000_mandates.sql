CREATE TABLE "mandate_constraints" (
	"mandate_id" uuid NOT NULL,
	"constraint_type" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "mandate_constraints_pk" PRIMARY KEY("mandate_id","constraint_type","value"),
	CONSTRAINT "mandate_constraints_type_check" CHECK ("mandate_constraints"."constraint_type" IN ('supplier_id', 'max_credit_amount')),
	CONSTRAINT "mandate_constraints_value_check" CHECK (length(trim("mandate_constraints"."value")) > 0),
	CONSTRAINT "mandate_constraints_amount_check" CHECK (CASE WHEN "mandate_constraints"."constraint_type" = 'max_credit_amount' THEN
    CASE WHEN "mandate_constraints"."value" ~ '^(0|[1-9][0-9]{0,15})$' THEN "mandate_constraints"."value"::numeric <= 9007199254740991 ELSE false END
    ELSE true END)
);
--> statement-breakpoint
CREATE TABLE "mandate_outbox" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"mandate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mandates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"business_key_id" text NOT NULL,
	"terms_hash" text NOT NULL,
	"title" text DEFAULT 'Order authorization' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approval_expires_at" timestamp with time zone DEFAULT now() + interval '1 hour' NOT NULL,
	"approved_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "mandates_user_id_business_key_id_unique" UNIQUE("user_id","business_key_id"),
	CONSTRAINT "mandates_business_key_check" CHECK (length(trim("mandates"."business_key_id")) > 0),
	CONSTRAINT "mandates_status_check" CHECK ("mandates"."status" IN ('pending','active','paused','revoked','expired')),
	CONSTRAINT "mandates_validity_check" CHECK ("mandates"."expires_at" > "mandates"."starts_at"),
	CONSTRAINT "mandates_expiry_check" CHECK ("mandates"."approved_at" IS NULL OR "mandates"."expires_at" > "mandates"."approved_at"),
	CONSTRAINT "mandates_approval_check" CHECK ("mandates"."status" NOT IN ('active', 'paused') OR "mandates"."approved_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "mandate_constraints" ADD CONSTRAINT "mandate_constraints_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandate_outbox" ADD CONSTRAINT "mandate_outbox_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mandate_constraints_one_amount" ON "mandate_constraints" USING btree ("mandate_id") WHERE "mandate_constraints"."constraint_type" = 'max_credit_amount';--> statement-breakpoint
CREATE INDEX "mandate_outbox_unpublished" ON "mandate_outbox" USING btree ("created_at") WHERE "mandate_outbox"."published_at" IS NULL;--> statement-breakpoint
CREATE INDEX "mandates_owner" ON "mandates" USING btree ("user_id","status");
--> statement-breakpoint
-- Bind the managed Mandate runtime login to this role after applying migrations.
CREATE ROLE mandate_runtime NOLOGIN;
GRANT USAGE ON SCHEMA public TO mandate_runtime;
GRANT SELECT, INSERT ON mandates, mandate_constraints, mandate_outbox TO mandate_runtime;
GRANT UPDATE(status, revoked_at, approved_at) ON mandates TO mandate_runtime;
GRANT UPDATE(published_at) ON mandate_outbox TO mandate_runtime;
-- Reviewed terms and constraints remain immutable to the runtime role.
