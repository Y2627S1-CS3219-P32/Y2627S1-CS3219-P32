CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" text NOT NULL,
	"next_message_seq" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_next_message_seq_check" CHECK ("conversations"."next_message_seq" >= 1)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"turn_id" uuid,
	"seq" bigint NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"tool_call_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_conversation_id_id_unique" UNIQUE("conversation_id","id"),
	CONSTRAINT "messages_conversation_id_seq_unique" UNIQUE("conversation_id","seq"),
	CONSTRAINT "messages_seq_check" CHECK ("messages"."seq" >= 1),
	CONSTRAINT "messages_role_check" CHECK ("messages"."role" IN ('system','user','assistant','tool')),
	CONSTRAINT "messages_tool_call_check" CHECK ("messages"."role" <> 'tool' OR ("messages"."tool_call_id" IS NOT NULL AND "messages"."turn_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "turn_outbox" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "turn_outbox_turn_id_event_type_unique" UNIQUE("turn_id","event_type")
);
--> statement-breakpoint
CREATE TABLE "turns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"trigger_message_id" uuid NOT NULL,
	"client_request_id" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "turns_trigger_message_id_unique" UNIQUE("trigger_message_id"),
	CONSTRAINT "turns_conversation_id_id_unique" UNIQUE("conversation_id","id"),
	CONSTRAINT "turns_conversation_id_client_request_id_unique" UNIQUE("conversation_id","client_request_id"),
	CONSTRAINT "turns_completion_check" CHECK (("turns"."finished_at" IS NULL AND "turns"."status" = 'processing') OR
    ("turns"."finished_at" IS NOT NULL AND "turns"."status" IN ('completed', 'failed')))
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_turn_id_turns_conversation_id_id_fk" FOREIGN KEY ("conversation_id","turn_id") REFERENCES "public"."turns"("conversation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_outbox" ADD CONSTRAINT "turn_outbox_conversation_id_turn_id_turns_conversation_id_id_fk" FOREIGN KEY ("conversation_id","turn_id") REFERENCES "public"."turns"("conversation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_trigger_message_fk" FOREIGN KEY ("conversation_id","trigger_message_id") REFERENCES "public"."messages"("conversation_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE INDEX "conversations_owner" ON "conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_tool_result" ON "messages" USING btree ("conversation_id","turn_id","tool_call_id") WHERE "messages"."role" = 'tool';--> statement-breakpoint
CREATE INDEX "messages_turn_history" ON "messages" USING btree ("conversation_id","turn_id","seq");--> statement-breakpoint
CREATE INDEX "turn_outbox_unpublished" ON "turn_outbox" USING btree ("created_at") WHERE "turn_outbox"."published_at" IS NULL;
--> statement-breakpoint
-- Local bootstrap roles; production binds separate managed logins to these NOLOGIN roles.
CREATE ROLE agent_chat NOLOGIN;
CREATE ROLE agent_execution NOLOGIN;
GRANT USAGE ON SCHEMA public TO agent_chat, agent_execution;
GRANT SELECT ON conversations, turns, messages TO agent_chat, agent_execution;
GRANT INSERT ON conversations, turns, messages, turn_outbox TO agent_chat;
GRANT UPDATE(title, next_message_seq, updated_at) ON conversations TO agent_chat;
GRANT SELECT, UPDATE ON turn_outbox TO agent_chat;
GRANT UPDATE(next_message_seq, updated_at) ON conversations TO agent_execution;
GRANT INSERT ON messages TO agent_execution;
GRANT UPDATE ON turns TO agent_execution;
-- Ownership is still checked on every query; these grants isolate acceptance from execution writes.
GRANT UPDATE(title) ON conversations TO agent_execution;
GRANT DELETE ON conversations, turns, messages, turn_outbox TO agent_chat;
