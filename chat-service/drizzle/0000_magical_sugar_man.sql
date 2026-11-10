CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"sender_id" integer NOT NULL,
	"body" varchar(2000) NOT NULL,
	"sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_rooms" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"requester_id" integer NOT NULL,
	"courier_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_order_id_chat_rooms_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."chat_rooms"("order_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_order_sent_idx" ON "chat_messages" USING btree ("order_id","sent_at","id");