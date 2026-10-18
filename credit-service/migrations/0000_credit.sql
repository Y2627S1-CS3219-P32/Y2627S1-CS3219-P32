CREATE TABLE "credit_accounts" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"total_credits" bigint NOT NULL,
	"reserved_credits" bigint NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_accounts_user_id_check" CHECK ("credit_accounts"."user_id" > 0),
	CONSTRAINT "credit_accounts_total_credits_check" CHECK ("credit_accounts"."total_credits" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "credit_accounts_check" CHECK ("credit_accounts"."reserved_credits" BETWEEN 0 AND "credit_accounts"."total_credits")
);
--> statement-breakpoint
CREATE TABLE "credit_orders" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"initial_grant" bigint,
	"request_payload" jsonb NOT NULL,
	"order_id" uuid,
	"user_id" integer NOT NULL,
	"status" text NOT NULL,
	"result" jsonb NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_orders_kind_check" CHECK ("credit_orders"."kind" IN ('ALLOCATE','RESERVE','TRANSFER','RELEASE')),
	CONSTRAINT "credit_orders_initial_grant_check" CHECK ("credit_orders"."initial_grant" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "credit_orders_status_check" CHECK ("credit_orders"."status" IN ('SUCCEEDED','REJECTED')),
	CONSTRAINT "credit_orders_check" CHECK (("credit_orders"."kind" = 'ALLOCATE' AND "credit_orders"."initial_grant" IS NOT NULL AND "credit_orders"."order_id" IS NULL) OR ("credit_orders"."kind" <> 'ALLOCATE' AND "credit_orders"."initial_grant" IS NULL AND "credit_orders"."order_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "credit_outbox" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "credit_outbox_request_id_key" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"transaction_id" uuid PRIMARY KEY NOT NULL,
	"credit_order_request_id" uuid NOT NULL,
	"debit_user_id" integer,
	"credit_user_id" integer NOT NULL,
	"debit_bucket" text NOT NULL,
	"credit_bucket" text NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_transactions_credit_order_request_id_key" UNIQUE("credit_order_request_id"),
	CONSTRAINT "credit_transactions_debit_bucket_check" CHECK ("credit_transactions"."debit_bucket" IN ('AVAILABLE','RESERVED','ISSUANCE')),
	CONSTRAINT "credit_transactions_credit_bucket_check" CHECK ("credit_transactions"."credit_bucket" IN ('AVAILABLE','RESERVED')),
	CONSTRAINT "credit_transactions_amount_check" CHECK ("credit_transactions"."amount" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "credit_transactions_check" CHECK (("credit_transactions"."debit_user_id" IS NULL) = ("credit_transactions"."debit_bucket" = 'ISSUANCE'))
);
--> statement-breakpoint
ALTER TABLE "credit_orders" ADD CONSTRAINT "credit_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."credit_accounts"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_outbox" ADD CONSTRAINT "credit_outbox_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."credit_orders"("request_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_credit_order_request_id_fkey" FOREIGN KEY ("credit_order_request_id") REFERENCES "public"."credit_orders"("request_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_debit_user_id_fkey" FOREIGN KEY ("debit_user_id") REFERENCES "public"."credit_accounts"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_credit_user_id_fkey" FOREIGN KEY ("credit_user_id") REFERENCES "public"."credit_accounts"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_one_allocation" ON "credit_orders" USING btree ("user_id") WHERE "credit_orders"."kind" = 'ALLOCATE' AND "credit_orders"."status" = 'SUCCEEDED';--> statement-breakpoint
CREATE UNIQUE INDEX "credit_one_movement" ON "credit_orders" USING btree ("order_id","kind") WHERE "credit_orders"."status" = 'SUCCEEDED' AND "credit_orders"."result"->>'applied' = 'true';--> statement-breakpoint
CREATE INDEX "credit_history" ON "credit_orders" USING btree ("order_id","kind","status");--> statement-breakpoint
CREATE INDEX "credit_unpublished" ON "credit_outbox" USING btree ("created_at") WHERE "credit_outbox"."published_at" IS NULL;