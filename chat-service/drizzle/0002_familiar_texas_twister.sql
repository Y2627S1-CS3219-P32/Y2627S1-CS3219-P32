CREATE TABLE "chat_room_members" (
	"order_id" uuid NOT NULL,
	"user_id" integer NOT NULL,
	CONSTRAINT "chat_room_members_order_id_user_id_pk" PRIMARY KEY("order_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "chat_room_members" ADD CONSTRAINT "chat_room_members_order_id_chat_rooms_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."chat_rooms"("order_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_room_members_user_idx" ON "chat_room_members" USING btree ("user_id");