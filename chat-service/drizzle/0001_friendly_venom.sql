ALTER TABLE "chat_rooms" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "chat_rooms_expires_at_idx" ON "chat_rooms" USING btree ("expires_at");